package com.magiccoffee.kiosk;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.util.Base64;
import android.util.Log;
import android.os.Build;
import android.annotation.SuppressLint;
import androidx.core.content.ContextCompat;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Typeface;
import java.io.InputStream;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.Charset;
import java.util.Arrays;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONObject;

@CapacitorPlugin(name = "UsbPrinter")
public class UsbPrinterPlugin extends Plugin {
  private static final String ACTION_USB_PERMISSION = "com.magiccoffee.kiosk.USB_PERMISSION";
  private static final String ACTION_TEST_RECEIPT = "com.magiccoffee.kiosk.PRINT_TEST_RECEIPT";
  private static final String TAG = "UsbPrinterPlugin";
  private static final Typeface DISPLAY_TYPEFACE = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD);
  private static final Typeface TEXT_TYPEFACE = Typeface.create("sans-serif-medium", Typeface.NORMAL);
  private static final Typeface LABEL_TYPEFACE = Typeface.create("sans-serif", Typeface.BOLD);
  private static final int BOARDING_PASS_LENGTH_DOTS = 150 * 8;

  private UsbManager usbManager;
  private UsbDeviceConnection connection;
  private UsbEndpoint endpointOut;
  private UsbInterface usbInterface;
  private UsbDevice currentDevice;
  private boolean testReceiverRegistered;

  private final BroadcastReceiver usbReceiver = new BroadcastReceiver() {
    public void onReceive(Context context, Intent intent) {
      String action = intent.getAction();
      if (ACTION_USB_PERMISSION.equals(action)) {
        synchronized (this) {
          UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
          if (device != null && intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
            Log.d(TAG, "USB permission granted for device vid=" + device.getVendorId() + " pid=" + device.getProductId());
            openDeviceAndPrepareEndpoint(device);
          } else {
            Log.w(TAG, "USB permission denied or device null");
          }
        }
      }
    }
  };

  private final BroadcastReceiver testPrintReceiver = new BroadcastReceiver() {
    @Override
    public void onReceive(Context context, Intent intent) {
      Log.d(TAG, "Test receipt broadcast received");
      new Thread(() -> {
        try {
          directPrintTestReceipt(intent);
          Log.d(TAG, "Test receipt print success");
        } catch (Exception e) {
          Log.e(TAG, "Test receipt print error", e);
        }
      }).start();
    }
  };

  @Override
  @SuppressLint("UnspecifiedRegisterReceiverFlag")
  public void load() {
    super.load();
    usbManager = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
    IntentFilter filter = new IntentFilter(ACTION_USB_PERMISSION);
    // Use NOT_EXPORTED for internal permission broadcast across all SDKs
    ContextCompat.registerReceiver(
      getContext(),
      usbReceiver,
      filter,
      ContextCompat.RECEIVER_NOT_EXPORTED
    );
    boolean debugBuild = (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    if (debugBuild) {
      ContextCompat.registerReceiver(
        getContext(),
        testPrintReceiver,
        new IntentFilter(ACTION_TEST_RECEIPT),
        ContextCompat.RECEIVER_EXPORTED
      );
      testReceiverRegistered = true;
    }
    Log.d(TAG, "Plugin loaded, receiver registered");
  }

  @Override
  protected void handleOnDestroy() {
    super.handleOnDestroy();
    try { getContext().unregisterReceiver(usbReceiver); } catch (Exception ignored) {}
    if (testReceiverRegistered) {
      try { getContext().unregisterReceiver(testPrintReceiver); } catch (Exception ignored) {}
      testReceiverRegistered = false;
    }
    closeConnection();
  }

  @PluginMethod
  public void printText(PluginCall call) {
    String text = call.getString("text", "");
    String encoding = call.getString("encoding", "UTF-8");
    if (text.isEmpty()) {
      call.reject("text boş olamaz");
      return;
    }

    Log.d(TAG, "printText called. encoding=" + encoding + " length=" + text.length());
    if (!preparePrinter(call)) return;

    try {
      // Initialize printer
      byte[] init = new byte[] { 0x1B, 0x40 }; // ESC @
      bulkWrite(init);

      // Align center for the receipt
      byte[] alignCenter = new byte[] { 0x1B, 'a', 0x01 };
      bulkWrite(alignCenter);

      // Print first line (header) in bold double-size if present
      String header;
      String rest;
      int idx = text.indexOf('\n');
      if (idx >= 0) {
        header = text.substring(0, idx);
        rest = text.substring(idx + 1);
      } else {
        header = text;
        rest = "";
      }

      if (!header.isEmpty()) {
        // Bold on
        bulkWrite(new byte[] { 0x1B, 0x45, 0x01 }); // ESC E 1
        // Double width & height
        bulkWrite(new byte[] { 0x1D, 0x21, 0x11 }); // GS ! 0x11
        bulkWrite((header + "\n").getBytes(Charset.forName(encoding)));
        // Reset styles
        bulkWrite(new byte[] { 0x1B, 0x45, 0x00 }); // ESC E 0
        bulkWrite(new byte[] { 0x1D, 0x21, 0x00 }); // GS ! 0
      }

      if (!rest.isEmpty()) {
        // Switch to left alignment for body to allow column formatting
        bulkWrite(new byte[] { 0x1B, 'a', 0x00 });
        bulkWrite(rest.getBytes(Charset.forName(encoding)));
      }

      // feed few lines (no cut here; cut should be called explicitly)
      byte[] lf = new byte[] { 0x0A, 0x0A };
      bulkWrite(lf);

      JSObject ret = new JSObject();
      ret.put("success", true);
      call.resolve(ret);
      Log.d(TAG, "printText success");
    } catch (Exception e) {
      Log.e(TAG, "printText error", e);
      call.reject("Yazdırma hatası: " + e.getMessage());
    }
  }

  @PluginMethod
  public void printRaw(PluginCall call) {
    String base64 = call.getString("base64");
    if (base64 == null) {
      call.reject("base64 zorunlu");
      return;
    }

    Log.d(TAG, "printRaw called. base64 length=" + base64.length());
    if (!preparePrinter(call)) return;

    try {
      byte[] payload = Base64.decode(base64, Base64.DEFAULT);
      bulkWrite(payload);
      JSObject ret = new JSObject();
      ret.put("success", true);
      call.resolve(ret);
      Log.d(TAG, "printRaw success");
    } catch (Exception e) {
      Log.e(TAG, "printRaw error", e);
      call.reject("Raw yazdırma hatası: " + e.getMessage());
    }
  }

  @PluginMethod
  public void prepareReceiptPrinter(PluginCall call) {
    if (!preparePrinter(call)) return;
    JSObject ret = new JSObject();
    ret.put("success", true);
    ret.put("vendorId", currentDevice != null ? currentDevice.getVendorId() : 0);
    ret.put("productId", currentDevice != null ? currentDevice.getProductId() : 0);
    call.resolve(ret);
  }

  @PluginMethod
  public void printOrderReceipt(PluginCall call) {
    if (!preparePrinter(call)) return;

    Bitmap receipt = null;
    try {
      String orderNumber = receiptText(call.getString("orderNumber", "MC----"));
      String createdAt = receiptText(call.getString("createdAt", ""));
      String fulfillment = receiptText(call.getString("fulfillment", "Restoranda"));
      String paymentMethod = receiptText(call.getString("paymentMethod", "Kart"));
      String paymentReference = receiptText(call.getString("paymentReference", "-"));
      String language = receiptText(call.getString("language", "tr"));
      String currency = receiptText(call.getString("currency", "TL"));
      Double subtotalValue = call.getDouble("subtotal");
      Double totalValue = call.getDouble("total");
      double total = totalValue != null ? totalValue : 0.0;
      double subtotal = subtotalValue != null ? subtotalValue : total;
      JSArray items = call.getArray("items");
      if (items == null) items = new JSArray();

      receipt = drawOrderReceiptBitmap(orderNumber, createdAt, fulfillment, paymentMethod, paymentReference, language, currency, subtotal, total, items);
      writeOrderReceiptBitmap(receipt);

      JSObject ret = new JSObject();
      ret.put("success", true);
      ret.put("vendorId", currentDevice != null ? currentDevice.getVendorId() : 0);
      ret.put("productId", currentDevice != null ? currentDevice.getProductId() : 0);
      call.resolve(ret);
      Log.d(TAG, "Magic Coffee order receipt printed. order=" + orderNumber);
    } catch (Exception e) {
      Log.e(TAG, "Order receipt print error", e);
      call.reject("Sipariş fişi yazdırılamadı: " + e.getMessage());
    } finally {
      if (receipt != null && !receipt.isRecycled()) receipt.recycle();
    }
  }

  @PluginMethod
  public void openDrawer(PluginCall call) {
    Log.d(TAG, "openDrawer called");
    if (!preparePrinter(call)) return;

    try {
      // ESC/POS cash drawer kick: ESC p m t1 t2
      // Common pulse: m=0, t1=64, t2=240 (units of 2ms)
      byte[] cmd = new byte[] { 0x1B, 0x70, 0x00, 0x40, (byte) 0xF0 };
      bulkWrite(cmd);
      JSObject ret = new JSObject();
      ret.put("success", true);
      call.resolve(ret);
      Log.d(TAG, "openDrawer success");
    } catch (Exception e) {
      Log.e(TAG, "openDrawer error", e);
      call.reject("Kasa açma hatası: " + e.getMessage());
    }
  }

  @PluginMethod
  public void printImageFromAsset(PluginCall call) {
    String assetPath = call.getString("assetPath");
    Integer targetWidth = call.getInt("width"); // optional
    if (assetPath == null || assetPath.isEmpty()) {
      call.reject("assetPath zorunlu");
      return;
    }

    if (!preparePrinter(call)) return;

    try {
      String normalized = assetPath.startsWith("public/") ? assetPath : ("public/" + assetPath);
      InputStream is = getContext().getAssets().open(normalized);
      Bitmap bmp = BitmapFactory.decodeStream(is);
      if (bmp == null) throw new Exception("Bitmap decode failed");

      int maxWidth = (targetWidth != null) ? targetWidth : 384;
      if (bmp.getWidth() > maxWidth) {
        float ratio = (float) maxWidth / (float) bmp.getWidth();
        int newH = Math.max(1, (int) (bmp.getHeight() * ratio));
        bmp = Bitmap.createScaledBitmap(bmp, maxWidth, newH, true);
      }

      // Align center for image as well
      bulkWrite(new byte[] { 0x1B, 'a', 0x01 });
      bulkWriteRasterBitmap(bmp);
      // Small feed after image
      bulkWrite(new byte[] { 0x0A });

      JSObject ret = new JSObject();
      ret.put("success", true);
      call.resolve(ret);
    } catch (Exception e) {
      Log.e(TAG, "printImageFromAsset error", e);
      call.reject("Resim yazdırma hatası: " + e.getMessage());
    }
  }

  @PluginMethod
  public void printImageBase64(PluginCall call) {
    String dataUrl = call.getString("dataUrl");
    String base64 = call.getString("base64");
    Integer targetWidth = call.getInt("width");

    String payload = dataUrl != null ? dataUrl : base64;
    if (payload == null || payload.isEmpty()) {
      call.reject("dataUrl veya base64 zorunlu");
      return;
    }

    if (!preparePrinter(call)) return;

    try {
      int commaIndex = payload.indexOf(",");
      if (payload.startsWith("data:") && commaIndex >= 0) {
        payload = payload.substring(commaIndex + 1);
      }

      byte[] decoded = Base64.decode(payload, Base64.DEFAULT);
      Bitmap bmp = BitmapFactory.decodeByteArray(decoded, 0, decoded.length);
      if (bmp == null) throw new Exception("Bitmap decode failed");

      int maxWidth = (targetWidth != null) ? targetWidth : 576;
      if (bmp.getWidth() != maxWidth) {
        float ratio = (float) maxWidth / (float) bmp.getWidth();
        int newH = Math.max(1, (int) (bmp.getHeight() * ratio));
        bmp = Bitmap.createScaledBitmap(bmp, maxWidth, newH, true);
      }

      bulkWrite(new byte[] { 0x1B, '@' });
      bulkWrite(new byte[] { 0x1B, 'a', 0x01 });
      bulkWriteRasterBitmap(bmp);
      bulkWrite(new byte[] { 0x0A });

      JSObject ret = new JSObject();
      ret.put("success", true);
      call.resolve(ret);
      Log.d(TAG, "printImageBase64 success");
    } catch (Exception e) {
      Log.e(TAG, "printImageBase64 error", e);
      call.reject("Base64 resim yazdırma hatası: " + e.getMessage());
    }
  }

  @PluginMethod
  public void printBoardingPass(PluginCall call) {
    if (!preparePrinter(call)) return;

    Bitmap bmp = null;
    try {
      String orderCode = safeText(call.getString("orderCode", "806"));
      String saleId = safeText(call.getString("saleId", "preview-sale"));
      String trackingUrl = call.getString("trackingUrl", "https://fullmoonui.magicpay.ai/t/" + orderCode);
      String currency = safeText(call.getString("currency", "TL"));
      Double totalValue = call.getDouble("total");
      double total = totalValue != null ? totalValue : 0.0;
      JSArray items = call.getArray("items");

      bmp = drawBoardingPassBitmap(orderCode, saleId, trackingUrl, currency, total, items);
      writeBoardingPassBitmap(bmp);

      JSObject ret = new JSObject();
      ret.put("success", true);
      call.resolve(ret);
      Log.d(TAG, "printBoardingPass success");
    } catch (Exception e) {
      Log.w(TAG, "printBoardingPass first attempt failed; reconnecting receipt printer", e);
      try {
        if (bmp == null) throw e;
        reconnectPrinterForRetry(false, null, null);
        writeBoardingPassBitmap(bmp);

        JSObject ret = new JSObject();
        ret.put("success", true);
        ret.put("retried", true);
        call.resolve(ret);
        Log.d(TAG, "printBoardingPass retry success");
      } catch (Exception retryError) {
        Log.e(TAG, "printBoardingPass retry error", retryError);
        call.reject("Boarding pass yazdırma hatası: " + retryError.getMessage());
      }
    } finally {
      if (bmp != null && !bmp.isRecycled()) bmp.recycle();
    }
  }

  private void writeBoardingPassBitmap(Bitmap bmp) throws Exception {
    bulkWrite(new byte[] { 0x1B, '@' });
    bulkWrite(new byte[] { 0x1B, 'a', 0x01 });
    bulkWriteRasterBitmap(bmp);
    feedBoardingPassToLength(bmp);
  }

  @PluginMethod
  public void prepareProductLabelPrinter(PluginCall call) {
    if (!preparePrinter(call, true)) return;
    JSObject ret = new JSObject();
    ret.put("success", true);
    ret.put("message", "TSC etiket yazıcısı hazır");
    call.resolve(ret);
  }

  @PluginMethod
  public void printProductLabels(PluginCall call) {
    if (!preparePrinter(call, true)) return;

    try {
      String orderCode = safeText(call.getString("orderCode", "TEST"));
      String saleId = safeText(call.getString("saleId", "preview-sale"));
      JSArray items = call.getArray("items");
      double labelWidthMm = boundedDouble(call.getDouble("labelWidthMm"), 100.0, 25.0, 120.0);
      double labelHeightMm = boundedDouble(call.getDouble("labelHeightMm"), 100.0, 20.0, 300.0);
      double gapMm = boundedDouble(call.getDouble("gapMm"), 2.0, 0.0, 20.0);
      int dpi = boundedInt(call.getInt("dpi"), 203, 152, 600);

      int totalLabels = 0;
      if (items != null) {
        for (int i = 0; i < items.length(); i++) {
          totalLabels += Math.max(1, items.getJSONObject(i).optInt("quantity", 1));
        }
      }
      if (totalLabels == 0) {
        call.reject("Etiket basılacak ürün bulunamadı");
        return;
      }

      int labelNumber = 0;
      for (int i = 0; items != null && i < items.length(); i++) {
        JSONObject item = items.getJSONObject(i);
        String productName = item.optString("name", "Ürün");
        String summary = item.optString("summary", "");
        int quantity = Math.max(1, item.optInt("quantity", 1));
        for (int copy = 0; copy < quantity; copy++) {
          labelNumber += 1;
          Bitmap bitmap = drawProductLabelBitmap(
            orderCode,
            saleId,
            productName,
            summary,
            labelNumber,
            totalLabels,
            labelWidthMm,
            labelHeightMm,
            dpi
          );
          printTsplBitmap(bitmap, labelWidthMm, labelHeightMm, gapMm);
          bitmap.recycle();
          Thread.sleep(120);
        }
      }

      JSObject ret = new JSObject();
      ret.put("success", true);
      ret.put("message", totalLabels + " ürün etiketi yazdırıldı");
      call.resolve(ret);
      Log.d(TAG, "printProductLabels success. labels=" + totalLabels + " order=" + orderCode);
    } catch (Exception e) {
      Log.e(TAG, "printProductLabels error", e);
      call.reject("TSC etiket yazdırma hatası: " + e.getMessage());
    }
  }

  @PluginMethod
  public void cut(PluginCall call) {
    try {
      bulkWrite(new byte[] { 0x1D, 'V', 0x42, 0x00 });
      JSObject ret = new JSObject();
      ret.put("success", true);
      call.resolve(ret);
    } catch (Exception e) {
      call.reject("Kesme hatası: " + e.getMessage());
    }
  }

  private void bulkWriteRasterBitmap(Bitmap bitmap) throws Exception {
    final int bandHeight = 24;
    int totalBytes = 0;
    int bands = 0;

    for (int startY = 0; startY < bitmap.getHeight(); startY += bandHeight) {
      int height = Math.min(bandHeight, bitmap.getHeight() - startY);
      byte[] raster = bitmapToEscPosRasterBand(bitmap, startY, height);
      bulkWrite(raster);
      totalBytes += raster.length;
      bands += 1;
      Thread.sleep(20);
    }

    Log.d(TAG, "bulkWriteRasterBitmap success. bytes=" + totalBytes + " bands=" + bands);
  }

  private void feedBoardingPassToLength(Bitmap bitmap) throws Exception {
    int remainingDots = Math.max(0, BOARDING_PASS_LENGTH_DOTS - bitmap.getHeight());
    int requestedDots = remainingDots;

    while (remainingDots > 0) {
      int chunk = Math.min(remainingDots, 255);
      bulkWrite(new byte[] { 0x1B, 'J', (byte) chunk });
      remainingDots -= chunk;
    }

    Log.d(TAG, "Boarding pass trailing feed complete. rasterDots=" + bitmap.getHeight()
      + " feedDots=" + requestedDots + " targetDots=" + BOARDING_PASS_LENGTH_DOTS);
  }

  private byte[] bitmapToEscPosRasterBand(Bitmap bitmap, int startY, int bandHeight) {
    int width = bitmap.getWidth();
    int height = bandHeight;

    int bytesPerRow = (width + 7) / 8;
    byte[] imageBytes = new byte[8 + bytesPerRow * height];

    // GS v 0 m xL xH yL yH header
    imageBytes[0] = 0x1D;
    imageBytes[1] = 0x76;
    imageBytes[2] = 0x30;
    imageBytes[3] = 0x00; // m=0, normal density
    imageBytes[4] = (byte) (bytesPerRow & 0xFF);
    imageBytes[5] = (byte) ((bytesPerRow >> 8) & 0xFF);
    imageBytes[6] = (byte) (height & 0xFF);
    imageBytes[7] = (byte) ((height >> 8) & 0xFF);

    int offset = 8;
    int threshold = 155; // Lower threshold keeps thermal text edges from getting too thick.

    int[] row = new int[width];
    for (int y = 0; y < height; y++) {
      bitmap.getPixels(row, 0, width, 0, startY + y, width, 1);
      int bitIndex = 0;
      byte current = 0;
      for (int x = 0; x < width; x++) {
        int color = row[x];
        int r = (color >> 16) & 0xFF;
        int g = (color >> 8) & 0xFF;
        int b = color & 0xFF;
        int gray = (r * 30 + g * 59 + b * 11) / 100;
        boolean black = gray < threshold;
        current <<= 1;
        if (black) current |= 0x01;
        bitIndex++;
        if (bitIndex == 8) {
          imageBytes[offset++] = current;
          bitIndex = 0;
          current = 0;
        }
      }
      if (bitIndex != 0) {
        current <<= (8 - bitIndex);
        imageBytes[offset++] = current;
      }
    }

    return imageBytes;
  }

  private void directPrintTestReceipt(Intent intent) throws Exception {
    ensurePrinterPreparedForBackgroundPrint();

    String orderCode = intent != null ? intent.getStringExtra("orderCode") : null;
    if (orderCode == null || orderCode.trim().isEmpty()) orderCode = "MC-TEST";

    JSArray items = new JSArray();
    JSONObject coffee = new JSONObject();
    coffee.put("name", "Caffe Latte");
    coffee.put("quantity", 1);
    coffee.put("unitPrice", 92.0);
    coffee.put("details", "Boyut: Orta | Süt: Yulaf Sütü");
    items.put(coffee);
    JSONObject menu = new JSONObject();
    menu.put("name", "Krem Peynirli Bagel");
    menu.put("quantity", 1);
    menu.put("unitPrice", 250.0);
    menu.put("details", "Ekstra: Krem Peynir");
    items.put(menu);
    JSONObject sauce = new JSONObject();
    sauce.put("name", "Extra Shot");
    sauce.put("quantity", 2);
    sauce.put("unitPrice", 20.0);
    items.put(sauce);

    Bitmap bmp = drawOrderReceiptBitmap(orderCode, "", "Burada", "Kredi / Banka Kartı", "TEST-REF", "tr", "TL", 382.0, 382.0, items);
    try {
      writeOrderReceiptBitmap(bmp);
    } finally {
      if (!bmp.isRecycled()) bmp.recycle();
    }
  }

  private void writeOrderReceiptBitmap(Bitmap bitmap) throws Exception {
    bulkWrite(new byte[] { 0x1B, '@' });
    bulkWrite(new byte[] { 0x1B, 'a', 0x01 });
    bulkWriteRasterBitmap(bitmap);
    // Leave enough paper below the footer before the automatic cutter runs.
    bulkWrite(new byte[] { 0x1B, 'd', 0x04 });
    bulkWrite(new byte[] { 0x1D, 'V', 0x42, 0x00 });
  }

  private Bitmap drawOrderReceiptBitmap(
    String orderNumber,
    String createdAt,
    String fulfillment,
    String paymentMethod,
    String paymentReference,
    String language,
    String currency,
    double subtotal,
    double total,
    JSArray items
  ) throws Exception {
    final int width = 576;
    final int workingHeight = Math.max(1300, 680 + (items != null ? items.length() * 170 : 0));
    final int ink = Color.BLACK;
    final int paper = Color.WHITE;
    final float left = 28;
    final float right = width - 28;

    Bitmap working = Bitmap.createBitmap(width, workingHeight, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(working);
    canvas.drawColor(paper);

    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    paint.setDither(true);
    paint.setSubpixelText(true);
    paint.setColor(ink);
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(3);

    // Compact monochrome coffee cup emblem.
    RectF emblem = new RectF(left, 22, left + 66, 88);
    canvas.drawRoundRect(emblem, 14, 14, paint);
    canvas.drawRoundRect(new RectF(left + 12, 43, left + 49, 72), 5, 5, paint);
    canvas.drawArc(new RectF(left + 42, 47, left + 61, 68), 270, 180, false, paint);
    canvas.drawLine(left + 16, 78, left + 55, 78, paint);

    paint.setStyle(Paint.Style.FILL);
    paint.setTypeface(DISPLAY_TYPEFACE);
    paint.setTextSize(34);
    canvas.drawText("MAGIC", 112, 51, paint);
    paint.setTextSize(20);
    paint.setLetterSpacing(.12f);
    canvas.drawText("COFFEE", 114, 80, paint);
    paint.setLetterSpacing(0);

    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(15);
    drawReceiptRightText(canvas, paint, "en".equals(language) ? "ORDER RECEIPT" : "SİPARİŞ FİŞİ", right, 45);
    paint.setTypeface(TEXT_TYPEFACE);
    paint.setTextSize(12);
    drawReceiptRightText(canvas, paint, "%100 COFFEE  •  %100 MAGIC", right, 70);

    paint.setStrokeWidth(4);
    canvas.drawLine(left, 106, right, 106, paint);
    paint.setStrokeWidth(1);
    canvas.drawLine(left, 113, right, 113, paint);

    float y = 142;
    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(13);
    drawReceiptCenteredText(canvas, paint, "en".equals(language) ? "ORDER NUMBER" : "SİPARİŞ NUMARASI", width / 2f, y);
    y += 47;
    paint.setTypeface(DISPLAY_TYPEFACE);
    paint.setTextSize(42);
    drawReceiptCenteredText(canvas, paint, receiptText(orderNumber), width / 2f, y);
    y += 25;

    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(3);
    canvas.drawRoundRect(new RectF(118, 126, width - 118, y + 2), 12, 12, paint);
    paint.setStyle(Paint.Style.FILL);

    y += 35;
    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(12);
    canvas.drawText("en".equals(language) ? "DATE" : "TARİH", left, y, paint);
    canvas.drawText("en".equals(language) ? "TIME" : "SAAT", 205, y, paint);
    canvas.drawText("en".equals(language) ? "ORDER TYPE" : "SİPARİŞ TİPİ", 330, y, paint);
    y += 24;
    paint.setTypeface(TEXT_TYPEFACE);
    paint.setTextSize(17);
    canvas.drawText(receiptDate(createdAt), left, y, paint);
    canvas.drawText(receiptTime(createdAt), 205, y, paint);
    drawReceiptRightText(canvas, paint, receiptText(fulfillment), right, y);

    y += 29;
    drawReceiptDashedRule(canvas, paint, left, right, y);
    y += 29;
    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(13);
    canvas.drawText("en".equals(language) ? "QTY" : "ADET", left, y, paint);
    canvas.drawText("en".equals(language) ? "ITEM / OPTIONS" : "ÜRÜN / SEÇİMLER", 82, y, paint);
    drawReceiptRightText(canvas, paint, "en".equals(language) ? "AMOUNT" : "TUTAR", right, y);
    y += 13;
    paint.setStrokeWidth(2);
    canvas.drawLine(left, y, right, y, paint);
    y += 31;

    int itemCount = items != null ? items.length() : 0;
    for (int i = 0; i < itemCount; i++) {
      JSONObject item = items.getJSONObject(i);
      int quantity = Math.max(1, item.optInt("quantity", 1));
      String name = receiptText(item.optString("name", "Ürün"));
      String details = receiptText(item.optString("details", ""));
      double unitPrice = Math.max(0, item.optDouble("unitPrice", 0));

      paint.setTypeface(TEXT_TYPEFACE);
      paint.setTextSize(20);
      List<String> nameLines = wrapReceiptText(paint, name, 345, 3);
      canvas.drawText(quantity + "x", left, y, paint);
      drawReceiptRightText(canvas, paint, moneyText(unitPrice * quantity, currency), right, y);
      for (int lineIndex = 0; lineIndex < nameLines.size(); lineIndex++) {
        canvas.drawText(nameLines.get(lineIndex), 82, y + lineIndex * 25, paint);
      }
      y += Math.max(1, nameLines.size()) * 25;

      if (quantity > 1) {
        paint.setTypeface(TEXT_TYPEFACE);
        paint.setTextSize(14);
        canvas.drawText(("en".equals(language) ? "Unit: " : "Birim: ") + moneyText(unitPrice, currency), 82, y, paint);
        y += 21;
      }

      if (!details.isEmpty()) {
        paint.setTypeface(TEXT_TYPEFACE);
        paint.setTextSize(15);
        List<String> detailLines = wrapReceiptText(paint, details, right - 82, 6);
        for (String line : detailLines) {
          canvas.drawText("• " + line, 82, y, paint);
          y += 21;
        }
      }

      y += 9;
      drawReceiptDashedRule(canvas, paint, 82, right, y);
      y += 23;
    }

    if (itemCount == 0) {
      paint.setTypeface(TEXT_TYPEFACE);
      paint.setTextSize(17);
      canvas.drawText("en".equals(language) ? "No order items found." : "Sipariş ürünü bulunamadı.", 82, y, paint);
      y += 40;
    }

    y += 4;
    paint.setTypeface(TEXT_TYPEFACE);
    paint.setTextSize(17);
    canvas.drawText("en".equals(language) ? "SUBTOTAL" : "ARA TOPLAM", left, y + 24, paint);
    drawReceiptRightText(canvas, paint, moneyText(subtotal, currency), right, y + 24);
    y += 47;
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(3);
    canvas.drawRoundRect(new RectF(left, y, right, y + 70), 10, 10, paint);
    paint.setStyle(Paint.Style.FILL);
    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(19);
    canvas.drawText("en".equals(language) ? "TOTAL PAID" : "ÖDENEN TOPLAM", left + 18, y + 43, paint);
    paint.setTypeface(DISPLAY_TYPEFACE);
    paint.setTextSize(29);
    drawReceiptRightText(canvas, paint, moneyText(total, currency), right - 18, y + 45);
    y += 101;

    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(13);
    canvas.drawText("en".equals(language) ? "PAYMENT" : "ÖDEME", left, y, paint);
    paint.setTypeface(TEXT_TYPEFACE);
    paint.setTextSize(17);
    canvas.drawText(receiptText(paymentMethod), left, y + 24, paint);

    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(3);
    canvas.drawRoundRect(new RectF(right - 112, y - 18, right, y + 30), 8, 8, paint);
    paint.setStyle(Paint.Style.FILL);
    paint.setTypeface(DISPLAY_TYPEFACE);
    paint.setTextSize(19);
    drawReceiptCenteredText(canvas, paint, "en".equals(language) ? "PAID" : "ÖDENDİ", right - 56, y + 13);
    y += 54;
    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(12);
    canvas.drawText("en".equals(language) ? "POS REFERENCE" : "POS REFERANSI", left, y, paint);
    y += 23;
    paint.setTypeface(TEXT_TYPEFACE);
    paint.setTextSize(14);
    canvas.drawText(ellipsizeToWidth(paint, receiptText(paymentReference), right - left), left, y, paint);
    y += 36;

    paint.setStrokeWidth(4);
    canvas.drawLine(left, y, right, y, paint);
    y += 41;
    paint.setTypeface(DISPLAY_TYPEFACE);
    paint.setTextSize(27);
    drawReceiptCenteredText(canvas, paint, "en".equals(language) ? "ENJOY!" : "AFİYET OLSUN!", width / 2f, y);
    y += 27;
    paint.setTypeface(TEXT_TYPEFACE);
    paint.setTextSize(14);
    drawReceiptCenteredText(canvas, paint, "en".equals(language) ? "Thank you for choosing us." : "Bizi tercih ettiğiniz için teşekkür ederiz.", width / 2f, y);
    y += 23;
    paint.setTextSize(12);
    drawReceiptCenteredText(canvas, paint, "en".equals(language) ? "This is not a fiscal receipt." : "Bu belge mali fiş yerine geçmez.", width / 2f, y);
    y += 29;
    drawReceiptDashedRule(canvas, paint, left, right, y);
    y += 23;
    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(11);
    drawReceiptCenteredText(canvas, paint, "MAGIC COFFEE  •  YENİ KAHVE MOLAN", width / 2f, y);

    int finalHeight = Math.min(workingHeight, Math.max(1, (int) Math.ceil(y + 24)));
    Bitmap result = Bitmap.createBitmap(working, 0, 0, width, finalHeight);
    working.recycle();
    return result;
  }

  private String receiptText(String value) {
    if (value == null) return "";
    return value.replaceAll("\\s+", " ").trim();
  }

  private List<String> wrapReceiptText(Paint paint, String value, float maxWidth, int maxLines) {
    String text = receiptText(value);
    List<String> lines = new ArrayList<>();
    if (text.isEmpty()) return lines;

    String current = "";
    for (String word : text.split("\\s+")) {
      String next = current.isEmpty() ? word : current + " " + word;
      if (paint.measureText(next) <= maxWidth) {
        current = next;
      } else {
        if (!current.isEmpty()) lines.add(current);
        current = word;
        if (lines.size() >= maxLines) break;
      }
    }
    if (!current.isEmpty() && lines.size() < maxLines) lines.add(current);
    if (lines.isEmpty()) lines.add(ellipsizeToWidth(paint, text, maxWidth));
    if (lines.size() == maxLines) {
      int last = lines.size() - 1;
      lines.set(last, ellipsizeToWidth(paint, lines.get(last), maxWidth));
    }
    return lines;
  }

  private void drawReceiptCenteredText(Canvas canvas, Paint paint, String value, float centerX, float baseline) {
    String text = receiptText(value);
    canvas.drawText(text, centerX - paint.measureText(text) / 2f, baseline, paint);
  }

  private void drawReceiptRightText(Canvas canvas, Paint paint, String value, float right, float baseline) {
    String text = receiptText(value);
    canvas.drawText(text, right - paint.measureText(text), baseline, paint);
  }

  private void drawReceiptDashedRule(Canvas canvas, Paint paint, float left, float right, float y) {
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(1);
    for (float x = left; x < right; x += 14) {
      canvas.drawLine(x, y, Math.min(x + 7, right), y, paint);
    }
    paint.setStyle(Paint.Style.FILL);
  }

  private void ensurePrinterPreparedForBackgroundPrint() throws Exception {
    if (connection != null && endpointOut != null && currentDevice != null
      && matchesRequestedPrinter(currentDevice, null, null, false)) {
      Log.d(TAG, "Printer already prepared for background print");
      return;
    }
    reconnectPrinterForRetry(false, null, null);
  }

  private Bitmap drawBoardingPassBitmap(String orderCode, String saleId, String trackingUrl, String currency, double total, JSArray items) throws Exception {
    final int designScale = 2;
    final int width = 576;
    final int height = 300;
    final int blue = Color.rgb(20, 125, 193);
    final int ink = Color.rgb(18, 19, 21);
    final int muted = Color.rgb(92, 96, 100);
    final int paper = Color.WHITE;

    Bitmap bmp = Bitmap.createBitmap(width * designScale, height * designScale, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(bmp);
    canvas.scale(designScale, designScale);
    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    paint.setSubpixelText(true);
    paint.setDither(true);
    paint.setColor(Color.WHITE);
    paint.setStyle(Paint.Style.FILL);
    canvas.drawRect(0, 0, width, height, paint);

    float x = 12;
    float y = 14;
    float w = width - 24;
    float h = height - 28;
    float itemDividerX = 270;
    float stubX = 456;

    paint.setColor(paper);
    paint.setStyle(Paint.Style.FILL);
    canvas.drawRoundRect(new RectF(x, y, x + w, y + h), 10, 10, paint);
    paint.setColor(Color.rgb(210, 210, 210));
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(2);
    canvas.drawRoundRect(new RectF(x, y, x + w, y + h), 10, 10, paint);

    // Thermal-safe: no large filled dark areas. The blue header becomes thin guide lines on paper.
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(3);
    paint.setColor(blue);
    canvas.drawLine(x + 18, y + 58, x + w - 18, y + 58, paint);
    canvas.drawLine(x + 18, y + h - 48, itemDividerX - 18, y + h - 48, paint);
    drawNativeDashedLine(canvas, paint, itemDividerX, y + 64, itemDividerX, y + h - 28);
    drawNativeDashedLine(canvas, paint, stubX, y, stubX, y + h);

    paint.setColor(Color.WHITE);
    paint.setStyle(Paint.Style.FILL);
    canvas.drawCircle(stubX, y + 56, 10, paint);
    canvas.drawCircle(stubX, y + h, 10, paint);

    drawLogoFromAsset(canvas, paint, 18, 15, 64, 64);

    paint.setColor(ink);
    paint.setTypeface(DISPLAY_TYPEFACE);
    paint.setTextSize(26);
    canvas.drawText("FULLMOON", 96, 48, paint);
    float passX = 96 + paint.measureText("FULLMOON") + 8;
    canvas.drawText("PASS", passX, 48, paint);
    paint.setTextSize(14);
    canvas.drawText("TO THE MOON", 466, 48, paint);

    drawNativeField(canvas, paint, "MISAFIR", "FULLMOON MİSAFİRİ", 34, 104, 122, 13, muted, ink);
    drawNativeField(canvas, paint, "TARIH", currentDate(), 166, 104, 60, 12, muted, ink);
    drawNativeField(canvas, paint, "SAAT", currentTime(), 230, 104, 34, 12, muted, ink);

    drawNativeField(canvas, paint, "KALKIS", "DÜNYA", 34, 160, 58, 16, muted, ink);
    drawNativeField(canvas, paint, "VARIS", "AY", 116, 160, 42, 16, muted, ink);
    drawNativeField(canvas, paint, "UCUS", "FM-" + orderCode, 214, 160, 48, 14, muted, ink);

    paint.setColor(ink);
    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(12);
    canvas.drawText("SIPARIS DETAYI", itemDividerX + 14, 101, paint);
    paint.setColor(Color.rgb(210, 212, 214));
    paint.setStrokeWidth(1);
    canvas.drawLine(itemDividerX + 14, 111, stubX - 14, 111, paint);

    paint.setColor(ink);
    paint.setTextSize(12);
    int rawItemCount = items != null ? items.length() : 0;
    int itemCount = Math.min(rawItemCount, 4);
    for (int i = 0; i < itemCount; i++) {
      JSONObject item = items.getJSONObject(i);
      int qty = Math.max(1, item.optInt("quantity", 1));
      String name = safeText(item.optString("name", "Urun"));
      double unitPrice = item.optDouble("unitPrice", 0.0);
      float rowY = 130 + i * 30;
      drawNativeFitText(canvas, paint, name, itemDividerX + 14, rowY, stubX - itemDividerX - 30, 12, ink);
      drawNativeFitText(canvas, paint, qty + " adet", itemDividerX + 14, rowY + 14, 56, 10, muted);
      drawNativeRightText(canvas, paint, moneyText(unitPrice * qty, currency), stubX - 13, rowY + 14, 11, ink);
      paint.setColor(Color.rgb(220, 220, 220));
      paint.setStrokeWidth(1);
      canvas.drawLine(itemDividerX + 14, rowY + 21, stubX - 14, rowY + 21, paint);
      paint.setColor(ink);
    }
    if (rawItemCount > itemCount) {
      drawNativeFitText(canvas, paint, "+" + (rawItemCount - itemCount) + " URUN", itemDividerX + 14, 130 + itemCount * 30, 135, 11, muted);
    }

    paint.setColor(blue);
    paint.setFakeBoldText(true);
    drawNativeFitText(canvas, paint, "SIPARISINIZ ALINDI • TESLIM EKRANI", 34, 252, 218, 9.5f, blue);
    drawNativeFitText(canvas, paint, "VEYA QR ILE ANLIK SIPARIS DURUMUNUZU", 34, 264, 218, 9.5f, blue);
    drawNativeFitText(canvas, paint, "TAKIP EDEBILIRSINIZ", 34, 276, 218, 9.5f, blue);
    paint.setFakeBoldText(false);

    paint.setColor(ink);
    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(10);
    canvas.drawText("SIPARIS NO", 466, 88, paint);
    drawNativeFitText(canvas, paint, "FM - " + orderCode, 466, 126, 88, 28, ink);
    drawNativeQr(canvas, paint, 458, 136, 104, trackingUrl);

    paint.setColor(muted);
    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(10);
    canvas.drawText("TAKIP QR", 476, 252, paint);
    canvas.drawText("TOPLAM", 466, 270, paint);
    drawNativeFitText(canvas, paint, moneyText(total, currency), 466, 292, 88, 15, ink);

    return rotateAndScaleForLandscapePrint(bmp);
  }

  private Bitmap drawProductLabelBitmap(
    String orderCode,
    String saleId,
    String productName,
    String summary,
    int labelNumber,
    int totalLabels,
    double labelWidthMm,
    double labelHeightMm,
    int dpi
  ) {
    final int widthDots = Math.max(200, (int) Math.round(labelWidthMm * dpi / 25.4));
    final int widthBytes = (widthDots + 7) / 8;
    final int bitmapWidth = widthBytes * 8;
    final int bitmapHeight = Math.max(160, (int) Math.round(labelHeightMm * dpi / 25.4));
    final float designWidth = 800f;
    final float designHeight = 800f;
    final int ink = Color.rgb(12, 14, 16);
    final int muted = Color.rgb(82, 86, 90);

    Bitmap bitmap = Bitmap.createBitmap(bitmapWidth, bitmapHeight, Bitmap.Config.RGB_565);
    Canvas canvas = new Canvas(bitmap);
    canvas.drawColor(Color.WHITE);
    canvas.save();
    canvas.scale(bitmapWidth / designWidth, bitmapHeight / designHeight);

    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    paint.setDither(true);
    paint.setSubpixelText(true);
    paint.setStyle(Paint.Style.STROKE);
    paint.setStrokeWidth(4);
    paint.setColor(ink);
    canvas.drawRoundRect(new RectF(18, 18, 782, 782), 18, 18, paint);

    drawLogoFromAsset(canvas, paint, 40, 42, 92, 92);
    paint.setStyle(Paint.Style.FILL);
    paint.setTypeface(DISPLAY_TYPEFACE);
    paint.setColor(ink);
    paint.setTextSize(48);
    canvas.drawText("FULLMOON", 150, 86, paint);
    paint.setTextSize(24);
    canvas.drawText("PRODUCT PASS  •  TO THE MOON", 152, 124, paint);

    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(17);
    paint.setColor(muted);
    canvas.drawText("SIPARIS NO", 592, 60, paint);
    drawNativeFitText(canvas, paint, "FM-" + safeText(orderCode), 590, 116, 172, 43, ink);

    paint.setColor(ink);
    paint.setStrokeWidth(3);
    canvas.drawLine(40, 152, 760, 152, paint);

    paint.setColor(muted);
    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(18);
    canvas.drawText("URUN", 42, 198, paint);
    drawNativeWrappedText(canvas, paint, productName, 42, 270, 716, 62, 2, ink, DISPLAY_TYPEFACE);

    paint.setColor(ink);
    paint.setStrokeWidth(2);
    canvas.drawLine(42, 390, 758, 390, paint);
    paint.setColor(muted);
    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(18);
    canvas.drawText("SECIMLER / ICERIK", 42, 430, paint);

    String normalizedSummary = safeText(summary);
    if (normalizedSummary.isEmpty()) {
      paint.setColor(muted);
      paint.setTypeface(TEXT_TYPEFACE);
      paint.setTextSize(27);
      canvas.drawText("Standart hazirlanacak", 44, 485, paint);
    } else {
      String detailText = normalizedSummary.replace(" · ", "  /  ");
      drawNativeWrappedText(canvas, paint, detailText, 42, 484, 716, 30, 5, ink, TEXT_TYPEFACE);
    }

    paint.setColor(ink);
    paint.setStrokeWidth(3);
    canvas.drawLine(40, 700, 760, 700, paint);
    paint.setTypeface(LABEL_TYPEFACE);
    paint.setTextSize(20);
    canvas.drawText("DUNYA  >  AY", 42, 746, paint);
    String sequence = "URUN " + labelNumber + " / " + totalLabels;
    paint.setTextSize(23);
    canvas.drawText(sequence, 400, 746, paint);
    String time = currentTime();
    paint.setTextSize(18);
    canvas.drawText(time, 690, 746, paint);

    canvas.restore();
    return bitmap;
  }

  private void drawNativeWrappedText(
    Canvas canvas,
    Paint paint,
    String value,
    float x,
    float firstBaseline,
    float maxWidth,
    float textSize,
    int maxLines,
    int color,
    Typeface typeface
  ) {
    String text = safeText(value);
    paint.setStyle(Paint.Style.FILL);
    paint.setTypeface(typeface);
    paint.setColor(color);
    paint.setTextSize(textSize);
    List<String> lines = new ArrayList<>();
    String current = "";
    for (String word : text.split("\\s+")) {
      String next = current.isEmpty() ? word : current + " " + word;
      if (paint.measureText(next) <= maxWidth) {
        current = next;
      } else {
        if (!current.isEmpty()) lines.add(current);
        current = word;
        if (lines.size() >= maxLines) break;
      }
    }
    if (!current.isEmpty() && lines.size() < maxLines) lines.add(current);
    float lineHeight = textSize * 1.22f;
    for (int i = 0; i < lines.size(); i++) {
      String line = lines.get(i);
      if (i == maxLines - 1 && (lines.size() == maxLines) && paint.measureText(line) > maxWidth) {
        line = ellipsizeToWidth(paint, line, maxWidth);
      }
      canvas.drawText(ellipsizeToWidth(paint, line, maxWidth), x, firstBaseline + i * lineHeight, paint);
    }
  }

  private void printTsplBitmap(Bitmap bitmap, double labelWidthMm, double labelHeightMm, double gapMm) throws Exception {
    int widthBytes = (bitmap.getWidth() + 7) / 8;
    byte[] raster = bitmapToTsplRaster(bitmap);
    String setup = String.format(
      java.util.Locale.US,
      "SIZE %.1f mm,%.1f mm\r\nGAP %.1f mm,0 mm\r\nSPEED 3\r\nDENSITY 8\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nCLS\r\nBITMAP 0,0,%d,%d,0,",
      labelWidthMm,
      labelHeightMm,
      gapMm,
      widthBytes,
      bitmap.getHeight()
    );
    bulkWrite(setup.getBytes(Charset.forName("US-ASCII")));
    bulkWrite(raster);
    bulkWrite("\r\nPRINT 1,1\r\n".getBytes(Charset.forName("US-ASCII")));
  }

  private byte[] bitmapToTsplRaster(Bitmap bitmap) {
    int width = bitmap.getWidth();
    int height = bitmap.getHeight();
    int bytesPerRow = (width + 7) / 8;
    byte[] output = new byte[bytesPerRow * height];
    int[] row = new int[width];
    int offset = 0;
    final int threshold = 170;
    for (int y = 0; y < height; y++) {
      bitmap.getPixels(row, 0, width, 0, y, width, 1);
      for (int byteIndex = 0; byteIndex < bytesPerRow; byteIndex++) {
        int packed = 0;
        for (int bit = 0; bit < 8; bit++) {
          int x = byteIndex * 8 + bit;
          if (x >= width) continue;
          int color = row[x];
          int red = (color >> 16) & 0xFF;
          int green = (color >> 8) & 0xFF;
          int blue = color & 0xFF;
          int gray = (red * 30 + green * 59 + blue * 11) / 100;
          if (gray < threshold) packed |= (0x80 >> bit);
        }
        output[offset++] = (byte) packed;
      }
    }
    return output;
  }

  private double boundedDouble(Double value, double fallback, double min, double max) {
    double actual = value != null ? value : fallback;
    return Math.max(min, Math.min(max, actual));
  }

  private int boundedInt(Integer value, int fallback, int min, int max) {
    int actual = value != null ? value : fallback;
    return Math.max(min, Math.min(max, actual));
  }

  private Bitmap rotateAndScaleForLandscapePrint(Bitmap bitmap) {
    final int targetLongSide = 1056;
    final int targetShortSide = 550;
    // Paper clearance is added after raster printing to reach the 15 cm target.
    // Avoid embedding that clearance as a blank strip inside the ticket artwork.
    final int trailingCutMargin = 0;
    Bitmap scaled = Bitmap.createScaledBitmap(bitmap, targetLongSide, targetShortSide, true);
    Matrix matrix = new Matrix();
    matrix.postRotate(90);
    Bitmap rotated = Bitmap.createBitmap(scaled, 0, 0, scaled.getWidth(), scaled.getHeight(), matrix, true);
    Bitmap withCutMargin = Bitmap.createBitmap(rotated.getWidth(), rotated.getHeight() + trailingCutMargin, Bitmap.Config.ARGB_8888);
    Canvas canvas = new Canvas(withCutMargin);
    Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    paint.setColor(Color.WHITE);
    paint.setStyle(Paint.Style.FILL);
    canvas.drawRect(0, 0, withCutMargin.getWidth(), withCutMargin.getHeight(), paint);
    canvas.drawBitmap(rotated, 0, 0, paint);
    Log.d(TAG, "Landscape receipt bitmap prepared. source=" + bitmap.getWidth() + "x" + bitmap.getHeight()
      + " scaled=" + scaled.getWidth() + "x" + scaled.getHeight()
      + " rotated=" + rotated.getWidth() + "x" + rotated.getHeight()
      + " withCutMargin=" + withCutMargin.getWidth() + "x" + withCutMargin.getHeight());
    return withCutMargin;
  }

  private void drawLogoFromAsset(Canvas canvas, Paint paint, int x, int y, int width, int height) {
    boolean previousFilter = paint.isFilterBitmap();
    try (InputStream is = getContext().getAssets().open("public/image/fullmoon-logo.png")) {
      Bitmap logo = BitmapFactory.decodeStream(is);
      if (logo != null) {
        paint.setFilterBitmap(true);
        canvas.drawBitmap(logo, null, new RectF(x, y, x + width, y + height), paint);
        logo.recycle();
      }
    } catch (Exception ignored) {
    } finally {
      paint.setFilterBitmap(previousFilter);
    }
  }

  private void drawNativeField(Canvas canvas, Paint paint, String label, String value, float x, float y, float width, float size, int muted, int ink) {
    paint.setTypeface(LABEL_TYPEFACE);
    paint.setSubpixelText(true);
    paint.setColor(muted);
    paint.setTextSize(10);
    canvas.drawText(safeText(label), x, y, paint);
    drawNativeFitText(canvas, paint, value, x, y + 23, width, size, ink);
  }

  private void drawNativeFitText(Canvas canvas, Paint paint, String value, float x, float y, float maxWidth, float size, int color) {
    String text = safeText(value);
    float textSize = size;
    paint.setTypeface(TEXT_TYPEFACE);
    paint.setSubpixelText(true);
    paint.setColor(color);
    do {
      paint.setTextSize(textSize);
      if (paint.measureText(text) <= maxWidth || textSize <= 9) break;
      textSize -= 1;
    } while (textSize > 9);
    canvas.drawText(ellipsizeToWidth(paint, text, maxWidth), x, y, paint);
  }

  private String ellipsizeToWidth(Paint paint, String text, float maxWidth) {
    if (paint.measureText(text) <= maxWidth) return text;
    String suffix = ".";
    String value = text;
    while (value.length() > 1 && paint.measureText(value + suffix) > maxWidth) {
      value = value.substring(0, value.length() - 1).trim();
    }
    return value + suffix;
  }

  private void drawNativeRightText(Canvas canvas, Paint paint, String value, float right, float y, float size, int color) {
    String text = safeText(value);
    paint.setTypeface(TEXT_TYPEFACE);
    paint.setSubpixelText(true);
    paint.setTextSize(size);
    paint.setColor(color);
    canvas.drawText(text, right - paint.measureText(text), y, paint);
  }

  private void drawNativeDashedLine(Canvas canvas, Paint paint, float x1, float y1, float x2, float y2) {
    paint.setColor(Color.rgb(150, 154, 158));
    paint.setStrokeWidth(2);
    float y = y1;
    while (y < y2) {
      canvas.drawLine(x1, y, x2, Math.min(y + 6, y2), paint);
      y += 13;
    }
  }

  private void drawNativeQr(Canvas canvas, Paint paint, float x, float y, float size, String content) {
    paint.setStyle(Paint.Style.FILL);
    paint.setColor(Color.WHITE);
    canvas.drawRect(x, y, x + size, y + size, paint);

    try {
      com.google.zxing.qrcode.QRCodeWriter writer = new com.google.zxing.qrcode.QRCodeWriter();
      Map<com.google.zxing.EncodeHintType, Object> hints = new EnumMap<>(com.google.zxing.EncodeHintType.class);
      hints.put(com.google.zxing.EncodeHintType.ERROR_CORRECTION, com.google.zxing.qrcode.decoder.ErrorCorrectionLevel.M);
      hints.put(com.google.zxing.EncodeHintType.MARGIN, 2);
      com.google.zxing.common.BitMatrix bitMatrix = writer.encode(content, com.google.zxing.BarcodeFormat.QR_CODE, (int) size, (int) size, hints);
      
      paint.setColor(Color.rgb(18, 19, 21));
      for (int i = 0; i < bitMatrix.getWidth(); i++) {
        for (int j = 0; j < bitMatrix.getHeight(); j++) {
          if (bitMatrix.get(i, j)) {
            canvas.drawRect(x + i, y + j, x + i + 1, y + j + 1, paint);
          }
        }
      }
    } catch (Exception e) {
      Log.e(TAG, "QR Code error", e);
      paint.setStyle(Paint.Style.STROKE);
      paint.setStrokeWidth(3);
      paint.setColor(Color.rgb(18, 19, 21));
      canvas.drawRect(x, y, x + size, y + size, paint);
      paint.setStyle(Paint.Style.FILL);
    }
  }

  private String currentDate() {
    return new java.text.SimpleDateFormat("dd.MM.yyyy", java.util.Locale.US).format(new java.util.Date());
  }

  private String currentTime() {
    return new java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(new java.util.Date());
  }

  private java.util.Date receiptTimestamp(String createdAt) {
    if (createdAt != null && createdAt.trim().length() >= 19) {
      try {
        java.text.SimpleDateFormat parser = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", java.util.Locale.US);
        parser.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return parser.parse(createdAt.trim().substring(0, 19));
      } catch (Exception ignored) {}
    }
    return new java.util.Date();
  }

  private String receiptDate(String createdAt) {
    return new java.text.SimpleDateFormat("dd.MM.yyyy", java.util.Locale.US).format(receiptTimestamp(createdAt));
  }

  private String receiptTime(String createdAt) {
    return new java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(receiptTimestamp(createdAt));
  }

  private String moneyText(double value, String currency) {
    return String.format(java.util.Locale.US, "%.2f %s", value, safeText(currency == null ? "TL" : currency));
  }

  private String safeText(String value) {
    if (value == null) return "";
    return value
      .replace('ı', 'i')
      .replace('İ', 'I')
      .replace('ş', 's')
      .replace('Ş', 'S')
      .replace('ğ', 'g')
      .replace('Ğ', 'G')
      .replace('ü', 'u')
      .replace('Ü', 'U')
      .replace('ö', 'o')
      .replace('Ö', 'O')
      .replace('ç', 'c')
      .replace('Ç', 'C')
      .replaceAll("\\s+", " ")
      .trim();
  }

  private boolean preparePrinter(PluginCall call) {
    return preparePrinter(call, false);
  }

  private boolean preparePrinter(PluginCall call, boolean preferTsc) {
    // Optional per-call override for VID/PID
    Integer vidOverride = call.getInt("vid");
    Integer pidOverride = call.getInt("pid");

    if (connection != null && endpointOut != null && currentDevice != null
      && matchesRequestedPrinter(currentDevice, vidOverride, pidOverride, preferTsc)) {
      Log.d(TAG, "Printer already prepared");
      return true;
    }

    UsbDevice target = findPrinterDevice(vidOverride, pidOverride, preferTsc);
    if (target == null) {
      Log.w(TAG, "No USB printer device found");
      call.reject("USB yazıcı bulunamadı. Lütfen VID/PID kontrol edin ve kabloyu kontrol edin.");
      return false;
    }

    if (!usbManager.hasPermission(target)) {
      Log.d(TAG, "Requesting USB permission for vid=" + target.getVendorId() + " pid=" + target.getProductId());
      Intent permIntent = new Intent(ACTION_USB_PERMISSION);
      // Make broadcast explicit to our own app package for safety on Android 13+
      permIntent.setPackage(getContext().getPackageName());
      PendingIntent pi = PendingIntent.getBroadcast(
        getContext(),
        0,
        permIntent,
        (Build.VERSION.SDK_INT >= 23) ? PendingIntent.FLAG_IMMUTABLE : 0
      );
      usbManager.requestPermission(target, pi);
      call.reject("USB izni gerekli. İzni verdikten sonra tekrar deneyin.");
      return false;
    }

    boolean ok = openDeviceAndPrepareEndpoint(target);
    if (!ok) {
      Log.e(TAG, "Failed to open endpoint");
      call.reject("Endpoint açılamadı");
      return false;
    }
    Log.d(TAG, "Printer prepared successfully");
    return true;
  }

  private UsbDevice findPrinterDevice(Integer vidOverride, Integer pidOverride) {
    return findPrinterDevice(vidOverride, pidOverride, false);
  }

  private UsbDevice findPrinterDevice(Integer vidOverride, Integer pidOverride, boolean preferTsc) {
    HashMap<String, UsbDevice> deviceList = usbManager.getDeviceList();
    Log.d(TAG, "Scanning devices. count=" + deviceList.size());
    List<UsbDevice> candidates = new ArrayList<>();
    for (UsbDevice device : deviceList.values()) {
      int vid = device.getVendorId();
      int pid = device.getProductId();
      Log.d(TAG, "Found device vid=" + vid + " pid=" + pid);

      // If override specified, match strictly
      if (vidOverride != null || pidOverride != null) {
        boolean vidMatches = vidOverride == null || vid == vidOverride;
        boolean pidMatches = pidOverride == null || pid == pidOverride;
        if (vidMatches && pidMatches && isPrinterInterfacePresent(device)) return device;
        else continue;
      }

      if (isPrinterInterfacePresent(device)) {
        candidates.add(device);
      }
    }

    // The kiosk has both a receipt printer and a label printer. Prefer the
    // known POS80 receipt device explicitly so a vendor-specific label device
    // can never be mistaken for the Fullmoon Pass printer.
    if (!preferTsc) {
      for (UsbDevice candidate : candidates) {
        if (isReceiptDevice(candidate)) {
          Log.d(TAG, "Selecting receipt printer vid=" + candidate.getVendorId()
            + " pid=" + candidate.getProductId());
          return candidate;
        }
      }
    }

    for (UsbDevice candidate : candidates) {
      if (preferTsc == isTscDevice(candidate)) {
        Log.d(TAG, "Selecting " + (preferTsc ? "TSC label" : "receipt") + " printer vid="
          + candidate.getVendorId() + " pid=" + candidate.getProductId());
        return candidate;
      }
    }

    // Never fall back to an arbitrary USB printer for labels. Sending TSPL
    // commands to the POS80 receipt printer can leave it unresponsive after a
    // successful Fullmoon Pass print when the TSC printer is disconnected.
    if (preferTsc) {
      Log.w(TAG, "TSC label printer not found; refusing receipt-printer fallback");
      return null;
    }
    if (!preferTsc && !candidates.isEmpty() && candidates.stream().noneMatch(this::isTscDevice)) {
      return candidates.get(0);
    }
    return null;
  }

  private boolean matchesRequestedPrinter(UsbDevice device, Integer vidOverride, Integer pidOverride, boolean preferTsc) {
    if (vidOverride != null && device.getVendorId() != vidOverride) return false;
    if (pidOverride != null && device.getProductId() != pidOverride) return false;
    if (vidOverride != null || pidOverride != null) return true;
    if (preferTsc) return isTscDevice(device);

    // When the known POS80 is attached, only that device is a valid receipt
    // connection. This prevents a stale label-printer endpoint from being
    // reused for a boarding pass.
    UsbDevice knownReceipt = findKnownReceiptDevice();
    return knownReceipt != null ? isReceiptDevice(device) : !isTscDevice(device);
  }

  private UsbDevice findKnownReceiptDevice() {
    for (UsbDevice device : usbManager.getDeviceList().values()) {
      if (isReceiptDevice(device) && isPrinterInterfacePresent(device)) return device;
    }
    return null;
  }

  private boolean isReceiptDevice(UsbDevice device) {
    // MASUNG IP1000 integrated in the Magic Coffee A12 kiosk.
    if (device.getVendorId() == 0x0519 && device.getProductId() == 0x2013) return true;
    // Legacy Brightek POS80 support for compatible kiosk enclosures.
    if (device.getVendorId() == 0x0416 && device.getProductId() == 0x5011) return true;
    try {
      String identity = ((device.getManufacturerName() == null ? "" : device.getManufacturerName())
        + " " + (device.getProductName() == null ? "" : device.getProductName())).toLowerCase(java.util.Locale.US);
      return identity.contains("ip1000 printer") || identity.contains("pos80") || identity.contains("receipt printer");
    } catch (Exception ignored) {
      return false;
    }
  }

  private boolean isTscDevice(UsbDevice device) {
    // TSC Auto ID's registered USB vendor ID. Product/manufacturer checks cover rebadged models.
    if (device.getVendorId() == 0x1203) return true;
    try {
      String identity = ((device.getManufacturerName() == null ? "" : device.getManufacturerName())
        + " " + (device.getProductName() == null ? "" : device.getProductName())).toLowerCase(java.util.Locale.US);
      return identity.contains("tsc") || identity.contains("tspl");
    } catch (Exception ignored) {
      return false;
    }
  }

  private boolean isPrinterInterfacePresent(UsbDevice device) {
    for (int i = 0; i < device.getInterfaceCount(); i++) {
      UsbInterface intf = device.getInterface(i);
      if (intf.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER
        || intf.getInterfaceClass() == UsbConstants.USB_CLASS_VENDOR_SPEC) {
        return true;
      }
    }
    return false;
  }

  private boolean openDeviceAndPrepareEndpoint(UsbDevice device) {
    closeConnection();
    currentDevice = device;

    // Pick first matching interface (Printer or Vendor)
    UsbInterface chosen = null;
    for (int i = 0; i < device.getInterfaceCount(); i++) {
      UsbInterface intf = device.getInterface(i);
      if (intf.getInterfaceClass() == UsbConstants.USB_CLASS_PRINTER
        || intf.getInterfaceClass() == UsbConstants.USB_CLASS_VENDOR_SPEC) {
        chosen = intf;
        break;
      }
    }
    if (chosen == null) return false;

    UsbDeviceConnection conn = usbManager.openDevice(device);
    if (conn == null) return false;

    if (!conn.claimInterface(chosen, true)) {
      conn.close();
      return false;
    }

    UsbEndpoint out = null;
    for (int i = 0; i < chosen.getEndpointCount(); i++) {
      UsbEndpoint ep = chosen.getEndpoint(i);
      if (ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK
        && ep.getDirection() == UsbConstants.USB_DIR_OUT) {
        out = ep;
        break;
      }
    }

    if (out == null) {
      conn.releaseInterface(chosen);
      conn.close();
      return false;
    }

    this.usbInterface = chosen;
    this.connection = conn;
    this.endpointOut = out;
    Log.d(TAG, "Endpoint prepared. iface=" + chosen.getId() + " outAddr=" + out.getAddress());
    return true;
  }

  private void reconnectPrinterForRetry(boolean preferTsc, Integer vidOverride, Integer pidOverride) throws Exception {
    closeConnection();
    UsbDevice target = findPrinterDevice(vidOverride, pidOverride, preferTsc);
    if (target == null) throw new Exception(preferTsc ? "Etiket yazıcısı bulunamadı" : "Fiş yazıcısı bulunamadı");
    if (!usbManager.hasPermission(target)) throw new Exception("USB yazıcı izni yok");
    if (!openDeviceAndPrepareEndpoint(target)) throw new Exception("USB yazıcı endpoint'i yeniden açılamadı");
    Log.d(TAG, "Printer reconnected for retry. vid=" + target.getVendorId() + " pid=" + target.getProductId());
  }

  private void bulkWrite(byte[] data) throws Exception {
    if (connection == null || endpointOut == null) throw new Exception("USB bağlantısı yok");
    int offset = 0;
    int timeout = 2000;
    int chunkSize = Math.max(1, endpointOut.getMaxPacketSize());
    int totalWritten = 0;
    while (offset < data.length) {
      int length = Math.min(chunkSize, data.length - offset);
      byte[] chunk = Arrays.copyOfRange(data, offset, offset + length);
      int write = connection.bulkTransfer(endpointOut, chunk, chunk.length, timeout);
      if (write <= 0) {
        closeConnection();
        throw new Exception("bulkTransfer başarısız: " + write);
      }
      offset += write;
      totalWritten += write;
    }
    Log.d(TAG, "bulkWrite success. bytes=" + totalWritten + " chunkSize=" + chunkSize);
  }

  private void closeConnection() {
    try {
      if (connection != null && usbInterface != null) {
        connection.releaseInterface(usbInterface);
      }
    } catch (Exception ignored) {}
    try {
      if (connection != null) connection.close();
    } catch (Exception ignored) {}
    connection = null;
    endpointOut = null;
    usbInterface = null;
    currentDevice = null;
  }
}
