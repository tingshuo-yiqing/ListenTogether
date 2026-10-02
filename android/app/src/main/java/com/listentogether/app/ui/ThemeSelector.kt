package com.listentogether.app.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.LightMode
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** 只保存界面外观，不改变连接、房间和播放状态；默认浅色，旧 System 偏好回落浅色。 */
internal enum class ThemeMode(val label: String) {
    Light("浅色"), Dark("深色")
}

@Composable
internal fun ThemeSelector(mode: ThemeMode, onChange: (ThemeMode) -> Unit) {
    var open by remember { mutableStateOf(false) }
    fun icon(value: ThemeMode) = when (value) {
        ThemeMode.Light -> Icons.Outlined.LightMode
        ThemeMode.Dark -> Icons.Outlined.DarkMode
    }
    Box {
        IconButton(onClick = { open = true }, modifier = Modifier.size(48.dp)) {
            Icon(icon(mode), "选择主题，当前：${mode.label}", tint = MaterialTheme.colorScheme.onSurface)
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            ThemeMode.entries.forEach { choice ->
                DropdownMenuItem(
                    text = { Text(choice.label) },
                    leadingIcon = { Icon(icon(choice), null) },
                    trailingIcon = { if (mode == choice) Icon(Icons.Outlined.Check, "已选择") },
                    onClick = { open = false; onChange(choice) }
                )
            }
        }
    }
}
