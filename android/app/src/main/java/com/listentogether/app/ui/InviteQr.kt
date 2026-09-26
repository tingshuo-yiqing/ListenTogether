package com.listentogether.app.ui

import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.common.BitMatrix
import com.google.zxing.qrcode.QRCodeWriter

/**
 * 生成邀请二维码矩阵。邀请口令包含中文，必须显式声明 UTF-8；否则 ZXing 默认字符集会把中文写成问号。
 */
internal fun encodeInviteQr(text: String, size: Int): BitMatrix = QRCodeWriter().encode(
    text,
    BarcodeFormat.QR_CODE,
    size,
    size,
    mapOf(EncodeHintType.CHARACTER_SET to "UTF-8", EncodeHintType.MARGIN to 1)
)
