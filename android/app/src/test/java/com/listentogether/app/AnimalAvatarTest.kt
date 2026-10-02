package com.listentogether.app

import com.listentogether.app.network.ChatEntry
import com.listentogether.app.network.RoomState
import com.listentogether.app.ui.animalAvatarResource
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

/** 头像来自服务端身份，覆盖同名成员、历史聊天与旧 v2 缺字段的兼容边界。 */
class AnimalAvatarTest {
    private fun state(members: String) = JSONObject("""{
        "hostId":"a", "members":$members, "track":null, "playing":false,
        "positionMs":0, "timestampMs":1000, "version":1
    }""")

    @Test fun sameNamedMembersKeepDifferentServerAvatars() {
        val parsed = RoomState.parse(state("""[
            {"id":"a","name":"朋友","online":true,"avatarId":"panda"},
            {"id":"b","name":"朋友","online":false,"avatarId":"rabbit"}
        ]"""))
        assertEquals(listOf("panda", "rabbit"), parsed.members.map { it.avatarId })
        assertEquals(listOf(true, false), parsed.members.map { it.online })
    }

    @Test fun olderV2MissingOrNullAvatarKeepsNicknameFallback() {
        val parsed = RoomState.parse(state("""[
            {"id":"a","name":"朋友","online":true},
            {"id":"b","name":"朋友","online":true,"avatarId":null}
        ]"""))
        assertTrue(parsed.members.all { it.avatarId == null })
        assertNull(animalAvatarResource(null))
        assertNull(animalAvatarResource("future_animal"))
    }

    @Test fun historicalChatKeepsAvatarWithoutPresentMember() {
        val json = JSONObject("""{"messageId":"m","seq":1,"senderId":"left-member",
            "senderName":"已离开的朋友","text":"你好","createdAtMs":1000,"senderAvatarId":"otter"}""")
        assertEquals("otter", ChatEntry.parse(json).senderAvatarId)
        assertEquals("left-member", ChatEntry.parse(json).senderId)
        assertNotNull(animalAvatarResource(ChatEntry.parse(json).senderAvatarId))
    }

    @Test fun olderChatWithNoAvatarStillParses() {
        val json = JSONObject("""{"messageId":"m","seq":1,"senderId":"a",
            "senderName":"朋友","text":"你好","createdAtMs":1000}""")
        assertNull(ChatEntry.parse(json).senderAvatarId)
        assertEquals("你好", ChatEntry.parse(json).text)
    }
}
