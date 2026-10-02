package com.listentogether.app.ui

import androidx.annotation.DrawableRes
import com.listentogether.app.R

/** 图片随 APK 离线内置；ID 与服务端及协议枚举一致，未知值返回 null 使用原昵称占位。 */
@DrawableRes
internal fun animalAvatarResource(avatarId: String?): Int? = when (avatarId) {
    "panda" -> R.drawable.avatar_panda
    "cat" -> R.drawable.avatar_cat
    "corgi" -> R.drawable.avatar_corgi
    "rabbit" -> R.drawable.avatar_rabbit
    "fox" -> R.drawable.avatar_fox
    "bear" -> R.drawable.avatar_bear
    "koala" -> R.drawable.avatar_koala
    "penguin" -> R.drawable.avatar_penguin
    "otter" -> R.drawable.avatar_otter
    "red_panda" -> R.drawable.avatar_red_panda
    "hamster" -> R.drawable.avatar_hamster
    "deer" -> R.drawable.avatar_deer
    "hedgehog" -> R.drawable.avatar_hedgehog
    "seal" -> R.drawable.avatar_seal
    "tiger" -> R.drawable.avatar_tiger
    else -> null
}
