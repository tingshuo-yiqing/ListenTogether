package com.listentogether.app.playback

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.media3.common.*
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.HttpDataSource
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.listentogether.app.ListenApplication
import com.listentogether.app.MainActivity
import com.listentogether.app.sync.SyncMath
import com.listentogether.app.sync.PlaybackPolicy
import kotlin.math.abs
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
    private var localPauseLogged = false

    /** 当前生效的追赶倍速（1.0 = 原速）；load/大漂移 seek 时复位。 */
    private var catchupSpeed = 1.0f

    override fun onCreate() {
        super.onCreate()
        http = DefaultHttpDataSource.Factory()
        player = ExoPlayer.Builder(this, SmoothRenderers(this)).setMediaSourceFactory(DefaultMediaSourceFactory(http)).build()
        player.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), true)
        player.setHandleAudioBecomingNoisy(true)
        player.setWakeMode(C.WAKE_MODE_NETWORK)
        player.addListener(object : Player.Listener {
            override fun onPlayerError(error: PlaybackException) {
                // 旧服务实例的播放错误不得标记新会话为本地暂停（代次守卫）。
                if (boundGeneration != null && client.sessionGeneration != boundGeneration) return
                diag.playback(null, player.currentMediaItem?.mediaId, client.state.value.room?.version ?: -1L,
                    player.currentPosition, player.currentPosition, 0, false, true, "error:" + error.errorCodeName, client.serverNow)
                // 令牌失效(401)与文件缺失(404)给可操作提示，其余保留错误码并引导重试。
                client.pauseLocally(PlaybackFailure.message(httpResponseCode(error), error.errorCodeName))
            }
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (!playWhenReady && (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY ||
                            reason == Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS)) {
                    // 丢失焦点/拔出耳机只暂停本机，不让同步快照重新开启声音。
                    // 代次守卫：旧服务实例不得替新会话触发本地暂停。
                    if (boundGeneration == null || client.sessionGeneration == boundGeneration)
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
        // 500ms 上报位置给 UI；每秒一次漂移自检——周期校时 5 秒才回调一次 applyState，
        // 渲染欠载型漂移（省电降频/后台负载）会在间隔内累积到 700ms+，把纠正拖成风暴。
        scope.launch {
            var tick = 0
            while (isActive) {
                // 代次守卫：旧服务实例不得向新会话上报位置或触发校准。
                if (boundGeneration != null && client.sessionGeneration != boundGeneration) {
                    stopSelf(); break
                }
                client.updatePosition(player.currentPosition)
                if (tick++ % 2 == 0) applyState()
                delay(500)
            }
        }
        applyState()
    }

    private fun applyState() {
        // 代次守卫：旧服务实例不得操作新会话的播放器（换曲/seek/变速/pause），
        // 否则双播放器竞态——旧实例按旧曲目 load/seek，新实例也在操作同一 player。
        // 守卫触发时 stopSelf 让系统销毁并重建实例，不让服务僵住。
        if (boundGeneration != null && client.sessionGeneration != boundGeneration) {
            player.pause(); stopSelf(); return
        }
        val ui = client.state.value
        val room = ui.room
        val credentials = ui.credentials
        if (credentials == null) {
            player.stop(); player.clearMediaItems(); stopSelf(); return
        }
        // 状态未就绪（连接中/校时中/重连中）或本地暂停时只暂停；恢复必须来自明确播放动作。
        if (!client.synchronized || room == null || ui.locallyPaused) {
            player.pause()
            // 暂停期间不保留追赶倍速，恢复后由校准逻辑重新决定。
            if (catchupSpeed != 1.0f) {
                catchupSpeed = 1.0f
                player.playbackParameters = player.playbackParameters.withSpeed(1.0f)
            }
            // 本机暂停会被快照周期反复触发；只在进入暂停沿记录一条，保证 JSONL 能看到焦点/耳机中断的时刻。
            if (ui.locallyPaused && !localPauseLogged) {
                localPauseLogged = true
                diag.playback(credentials.code, player.currentMediaItem?.mediaId, room?.version ?: -1L,
                    player.currentPosition, player.currentPosition, 0, false, true, "localPause", client.serverNow)
            }
            return
        }
        localPauseLogged = false
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
            catchupSpeed = 1.0f
            correction = "load"
        } else if (!buffering && SyncMath.needsSeek(actualBefore, expected)) {
            // 分级纠正（漂移 = 服务端目标 - 本机位置，正值为落后）：
            // 500ms–2.5s 用连续变速追赶——不丢缓冲、不出声音缺口，追上即恢复原速；
            // 超过 2.5s 才真正 seek——seek 会丢弃已缓冲数据并重新起流，本身就是一次可闻中断。
            // 缓冲期间位置不可信，不反复纠正；缓冲结束的 onPlaybackStateChanged 会再次触发校准。
            val drift = expected - actualBefore
            if (abs(drift) > SyncMath.SPEED_MAX_DRIFT_MS) {
                player.seekTo(expected)
                catchupSpeed = 1.0f
                correction = "seek"
            } else {
                val speed = SyncMath.catchupSpeed(drift)
                if (abs(speed - catchupSpeed) >= 0.01f) {
                    catchupSpeed = speed
                    player.playbackParameters = player.playbackParameters.withSpeed(speed)
                }
                correction = "speed"
            }
        } else if (!buffering && catchupSpeed != 1.0f && abs(expected - actualBefore) <= SyncMath.SPEED_DONE_MS) {
            catchupSpeed = 1.0f
            player.playbackParameters = player.playbackParameters.withSpeed(1.0f)
            correction = "speed"
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

/**
 * 渲染工厂：把 AudioTrack 缓冲加大到约 0.7 秒（默认只有几十毫秒）。
 * 真机实测（2026-09-23，PHQ110）发现省电降频/后台负载会周期性饿死渲染线程：
 * audio_flinger 大量 underrun，播放位置以 ~0.86x 落后于服务端，听感即"卡顿音"。
 * 更大的 track 缓冲可吸收调度抖动、明显减少欠载；只增不减，低于系统最小值时仍用系统值。
 * 位置上报与同步不受缓冲深度影响（currentPosition 仍按已渲染帧计算）。
 */
@UnstableApi
private class SmoothRenderers(context: Context) : DefaultRenderersFactory(context) {
    override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioTrackPlaybackParams: Boolean): AudioSink =
        DefaultAudioSink.Builder(context)
            .setEnableFloatOutput(enableFloatOutput)
            .setEnableAudioTrackPlaybackParams(enableAudioTrackPlaybackParams)
            .setAudioTrackBufferSizeProvider { minBufferSize, _, _, _, _, _, _ -> maxOf(minBufferSize, AUDIO_TRACK_BUFFER_BYTES) }
            .build()

    private companion object {
        /** 约 0.7 秒（44.1kHz 立体声 16bit ≈ 176KB/s）。 */
        const val AUDIO_TRACK_BUFFER_BYTES = 120_000
    }
}
