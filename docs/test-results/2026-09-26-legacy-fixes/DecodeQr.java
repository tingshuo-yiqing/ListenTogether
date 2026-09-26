import com.google.zxing.BinaryBitmap;
import com.google.zxing.MultiFormatReader;
import com.google.zxing.RGBLuminanceSource;
import com.google.zxing.common.HybridBinarizer;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.imageio.ImageIO;

/** 独立解码设备截图中的二维码；Base64 输出避免 Windows 控制台改写中文。 */
public final class DecodeQr {
    public static void main(String[] args) throws Exception {
        var image = ImageIO.read(new File(args[0]));
        var pixels = image.getRGB(0, 0, image.getWidth(), image.getHeight(), null, 0, image.getWidth());
        var source = new RGBLuminanceSource(image.getWidth(), image.getHeight(), pixels);
        var result = new MultiFormatReader().decode(new BinaryBitmap(new HybridBinarizer(source)));
        System.out.println(Base64.getEncoder().encodeToString(result.getText().getBytes(StandardCharsets.UTF_8)));
    }
}
