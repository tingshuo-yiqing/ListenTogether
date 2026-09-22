package com.listentogether.app.playback

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.*
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.listentogether.app.ListenApplication
import com.listentogether.app.MainActivity
import com.listentogether.app.sync.SyncMath
import com.listentogether.app.sync.PlaybackPolicy
import kotlinx.coroutines.*

/**
 * 播放服务：持有 ExoPlayer 与 MediaSession，按会话状态执行同步校准。
 *
 * 会话绑定：创建时通过 [com.listentogether.app.network.RoomClient.attachStateObserver]
 * 捕获当时的会话代次；销毁/任务移除只作用于相同代次的会话——
 * 若用户已离开或另起新会话，旧服务实例只释放自身资源，
 * 不清除新会话的状态回调，也不替新会话发送退出请求。
 * 通知栏/耳机操作和页面按钮走同一条权限路径；同步只操作底层 player，避免回发循环。
 */
@UnstableApi
class PlaybackService : MediaSessionService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val client get() = (application as ListenApplication).roomClient
    private val diag get() = (application as ListenApplication).diagnostics
    private lateinit var player: ExoPlayer
    private lateinit var http: DefaultHttpDataSource.Factory
    private var session: MediaSession? = null

    /** 创建时绑定的会话代次；清理动作只允许作用于相同代次。 */
    private var boundGeneration: Int? = null
    private var lastBuffering = false

    override fun onCreate() {
        super.onCreate()
        http = DefaultHttpDataSource.Factory()
        player = ExoPlayer.Builder(this).setMediaSourceFactory(DefaultMediaSourceFactory(http)).build()
        player.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
        player.setHandleAudioBecomingNoisy(true)
        player.setWakeMode(C.WAKE_MODE_NETWORK)
        player.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                diag.playback(null, player.currentMediaItem?.mediaId, client.state.value.room?.version ?: -1L,
                    player.currentPosition, player.currentPosition, 0, false, true, "error:" + error.errorCodeName, client.serverNow)
                // 令牌失效(401)与文件缺失(404)给可操作提示，其余保留错误码并引导重试。
                client.pauseLocally(PlaybackFailure.message(httpResponseCode(error), error.errorCodeName))
            }
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (!playWhenReady && (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY ||
                            reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS)) {
                    // 丢失焦点/拔出耳机只暂停本机，不让同步快照重新开启声音。
                    client.pauseLocally("音频输出已中断，点击播放恢复跟听")
                }
            }
            override fun onPlaybackStateChanged(playbackState: Int) {
                // 缓冲期间不 seek；缓冲结束后立即按最新快照重新校准一次。
                if (playbackState == Player.STATE_BUFFERING || playbackState == Player.STATE_READY) applyState()
            }
        })
        val controlled = object : ForwardingSimpleBasePlayer(player) {
            override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
                client.setPlaying(playWhenReady)
                return Futures.immediateVoidFuture()
            }
            override fun handleStop(): ListenableFuture<*> {
                client.setPlaying(false)
                return Futures.immediateVoidFuture()
            }
            override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
                if (client.isHost) client.command("seek", positionMs = positionMs.coerceAtLeast(0))
                return Futures.immediateVoidFuture()
            }
        }
        val activity = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        session = MediaSession.Builder(this, controlled).setSessionActivity(activity).build()
        // 只绑定创建时的会话；之后用户换房间，旧实例销毁也不会影响新会话的回调。
        boundGeneration = client.attachStateObserver { applyState() }
        scope.launch { while (isActive) { client.updatePosition(player.currentPosition); delay(500) } }
        applyState()
    }

    private fun applyState() {
        val ui = client.state.value
        val room = ui.room
        val credentials = ui.credentials
        if (credentials == null) {
            player.stop(); player.clearMediaItems(); stopSelf(); return
        }
        // 状态未就绪（连接中/校时中/重连中）或本地暂停时只暂停；恢复必须来自明确播放动作。
        if (!client.synchronized || room == null || ui.locallyPaused) { player.pause(); return }
        val track = ui.tracks.find { it.id == room.trackId }
        if (track == null) { player.pause(); return }
        http.setDefaultRequestProperties(mapOf("Authorization" to "Bearer " + credentials.token))
        val expected = SyncMath.target(room.positionMs, room.timestampMs, room.playing, client.serverNow, track.durationMs)
        val changed = player.currentMediaItem?.mediaId != track.id
        val buffering = player.playbackState == Player.STATE_BUFFERING
        val actualBefore = player.currentPosition
        var correction = ""
        if (changed) {
            val item = MediaItem.Builder().setMediaId(track.id)
                .setUri(client.baseUrl + "/api/rooms/" + credentials.code + "/audio/" + track.id)
                .setMediaMetadata(MediaMetadata.Builder().setTitle(track.title).setArtist("一起听歌").build()).build()
            player.setMediaItem(item, expected); player.prepare()
            correction = "load"
        } else if (!buffering && SyncMath.needsSeek(actualBefore, expected)) {
            // 缓冲期间位置不可信，不反复 seek；缓冲结束的 onPlaybackStateChanged 会再次触发校准。
            player.seekTo(expected)
            correction = "seek"
        }
        if (player.playbackState == Player.STATE_IDLE) player.prepare()
        player.playWhenReady = PlaybackPolicy.shouldPlay(client.synchronized, room.playing, ui.locallyPaused)
        // seek/装载后立即上报位置，不等 500ms 周期；UI 的乐观预览需要它无缝衔接服务器进度。
        if (correction.isNotEmpty()) client.updatePosition(player.currentPosition)
        diag.playback(credentials.code, track.id, room.version, actualBefore, expected, expected - actualBefore,
            buffering, ui.locallyPaused, correction, client.serverNow)
        // 缓冲进入/退出各记录一条，便于统计缓冲次数与持续时间。
        if (buffering != lastBuffering) {
            lastBuffering = buffering
            diag.playback(credentials.code, track.id, room.version, actualBefore, expected, expected - actualBefore,
                buffering, ui.locallyPaused, "buffering", client.serverNow)
        }
    }

    /** 沿异常链找 HTTP 数据源状态码；无 HTTP 状态的错误（断网、解码失败）返回 null。 */
    private fun httpResponseCode(error: Throwable?): Int? {
        var cause: Throwable? = error
        while (cause != null) {
            if (cause is HttpDataSource.InvalidResponseCodeException) return cause.responseCode
            cause = cause.cause
        }
        return null
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        // 页面移除不应中断正在播放的前台服务；未播放时释放房间和资源。
        // 只有仍绑定当前会话才允许本实例退出房间，避免旧服务实例替新会话退出。
        val bound = boundGeneration
        if (!player.playWhenReady) {
            if (bound != null && client.sessionGeneration == bound) client.leave()
            stopSelf()
        }
    }

    override fun onDestroy() {
        // 只结束自身绑定的会话：若用户已另起新会话（代次变化），本实例仅释放播放器，
        // 不清除新会话的状态回调，也不发送退出请求。
        val bound = boundGeneration
        if (bound != null && client.sessionGeneration == bound) {
            client.detachStateObserver(bound)
            client.leave()
        }
        scope.cancel(); session?.release(); player.release()
        super.onDestroy()
    }
}
