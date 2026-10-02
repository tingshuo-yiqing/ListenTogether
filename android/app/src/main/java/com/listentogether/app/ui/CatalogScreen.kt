package com.listentogether.app.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.listentogether.app.network.*
import com.listentogether.app.ui.theme.FieldShape
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/** 会话内的检索结果；代次在输入变化后作废旧请求，取消不显示为网络错误。 */
@Stable
internal class CatalogSearchState(private val fetch: suspend (String, Int, String?) -> CatalogPage) {
    var page by mutableStateOf<CatalogPage?>(null)
        private set
    var loading by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set
    var reload by mutableIntStateOf(0)
    private var generation = 0
    private var nextOffset = 0

    fun invalidate() { generation++ }

    suspend fun loadFirst(query: String) {
        val expected = ++generation
        loading = true; error = null; page = null; nextOffset = 0
        try {
            delay(300)
            val result = fetch(query.trim(), 0, null)
            if (expected == generation) { page = result; nextOffset = result.offset + result.items.size }
        } catch (e: CancellationException) { throw e }
        catch (_: CatalogChangedException) { if (expected == generation) reload++ }
        catch (e: Exception) { if (expected == generation) error = e.message ?: "搜索失败，请重试" }
        finally { if (expected == generation) loading = false }
    }

    suspend fun loadMore(query: String) {
        val current = page ?: return
        if (loading || nextOffset >= current.total) return
        val expected = generation
        loading = true; error = null
        try {
            val result = fetch(query.trim(), nextOffset, current.catalogRevision)
            if (expected == generation) {
                page = appendCatalogPage(current, result); nextOffset = result.offset + result.items.size
            }
        } catch (e: CancellationException) { throw e }
        catch (_: CatalogChangedException) { if (expected == generation) { page = null; reload++ } }
        catch (e: Exception) { if (expected == generation) error = e.message ?: "加载更多失败，请重试" }
        finally { if (expected == generation) loading = false }
    }
}

@Composable
internal fun CatalogScreen(client: RoomClient, ui: UiState, search: CatalogSearchState, query: String, onQuery: (String) -> Unit, onMore: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(value = query, onValueChange = onQuery, singleLine = true, shape = FieldShape,
                modifier = Modifier.weight(1f), label = { Text("搜索歌名或歌手") }, leadingIcon = { Icon(Icons.Outlined.Search, null) })
            IconButton(onClick = { client.queueAddRandom(1) }, enabled = ui.status == ConnectionStatus.Ready && !ui.randomAdding, modifier = Modifier.size(48.dp)) {
                if (ui.randomAdding) CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp)
                else Icon(Icons.Outlined.Shuffle, "随机点一首")
            }
        }
        search.error?.let { error ->
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(error, Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite }, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                TextButton(onClick = { if (search.page == null) search.reload++ else onMore() }) { Text("重试") }
            }
        }
        val page = search.page
        if (search.loading && page == null) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        else if (page != null) {
            if (page.items.isEmpty()) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("没有找到歌曲", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            else LazyColumn(Modifier.weight(1f), state = rememberLazyListState(), contentPadding = PaddingValues(top = 12.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                items(page.items, key = { it.id }, contentType = { "song" }) { song ->
                    val added = song.id == ui.room?.track?.id || ui.queue?.entries?.any { it.trackId == song.id } == true
                    Row(Modifier.fillMaxWidth().heightIn(min = 68.dp), verticalAlignment = Alignment.CenterVertically) {
                        SongCover(client, song)
                        SongCopy(song.title, song.artist, Modifier.weight(1f).padding(horizontal = 12.dp))
                        IconButton(onClick = { client.queueAdd(song.id) }, enabled = ui.status == ConnectionStatus.Ready && !added && song.id !in ui.queueAdding) {
                            if (song.id in ui.queueAdding) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                            else Icon(if (added) Icons.Outlined.Check else Icons.Outlined.Add, if (added) "已点 ${song.title}" else "点歌 ${song.title}")
                        }
                    }
                }
                if (page.items.size < page.total) item {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        if (search.loading) CircularProgressIndicator(Modifier.padding(16.dp).size(24.dp), strokeWidth = 2.dp)
                        else TextButton(onClick = onMore) { Text("加载更多") }
                    }
                }
            }
        }
    }
}

@Composable
internal fun SongCover(client: RoomClient, track: Track) {
    val bitmap = rememberCoverBitmap(client, track, 48.dp)
    if (bitmap == null) CoverPlaceholder(48.dp, 10.dp)
    else Image(bitmap.asImageBitmap(), null, Modifier.size(48.dp).clip(RoundedCornerShape(10.dp)), contentScale = ContentScale.Crop)
}

@Composable
internal fun SongCopy(title: String, artist: String?, modifier: Modifier) {
    Column(modifier.padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (!artist.isNullOrBlank()) Text(artist, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}
