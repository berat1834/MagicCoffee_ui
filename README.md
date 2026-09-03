# Magic Coffee Kiosk

Magic Coffee için dokunmatik kiosk arayüzüdür. Katalog ve fiyat bilgisini API'den alır.

## Gereksinimler

- Node.js 20+
- Magic Coffee API: `http://127.0.0.1:8300`

## Kurulum

```powershell
npm install
npm run dev
```

Kiosk geliştirme adresi:

```text
http://127.0.0.1:5370
```

Üretim derlemesi:

```powershell
npm run build
```

## Akış

1. Karşılama
2. Burada / Paket
3. Tümü varsayılan kategori görünümü
4. Dinamik içecek özelleştirme
5. Sepet
6. Ödeme
7. Başarı ekranı

Kiosk, canlı API üzerinden Pavo Cloud ödeme durumunu izler ve başarılı siparişi yalnızca bir kez kaydeder. Android sürümü MASUNG IP1000 USB fiş yazıcısını `UsbPrinter` Capacitor eklentisiyle kullanır; tarayıcıda donanım çağrısı güvenle atlanır.

```powershell
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```
