/**
 * Scan dialog — captures a medicine box barcode / QR via the device camera,
 * or from an image file, and hands the code back to the caller.
 *
 * IMPORTANT (honest status): scanning only reads the printed code. There is no
 * free, complete drug database we can hit to auto-fill the Arabic/English name,
 * so the name is still entered manually after a scan. The code is stored on the
 * medication for quick re-entry.
 *
 * `html5-qrcode` is imported lazily so it never touches the bundle unless the
 * user actually opens the scanner.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (code: string) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyScanner = any;

export function ScanDialog({ open, onOpenChange, onScan }: Props) {
  const [status, setStatus] = useState('');
  const [cameraError, setCameraError] = useState(false);
  const scannerRef = useRef<AnyScanner>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setCameraError(false);
    setStatus('جارٍ تشغيل الكاميرا…');

    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;
        const scanner: AnyScanner = new Html5Qrcode('ht-qr-reader', { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: 240 },
          (text: string) => {
            onScan(text);
            onOpenChange(false);
          },
          () => {
            /* scan failures fire continuously until a code is found — ignore */
          },
        );
        if (!cancelled) setStatus('وجّه الكاميرا نحو الباركود أو رمز الاستجابة السريعة');
      } catch {
        if (cancelled) return;
        setCameraError(true);
        setStatus('تعذّر تشغيل الكاميرا. يمكنك اختيار صورة للعلبة بدلاً من ذلك.');
      }
    })();

    return () => {
      cancelled = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        s.stop()
          .then(() => s.clear())
          .catch(() => {});
      }
    };
  }, [open, onScan, onOpenChange]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setStatus('جارٍ قراءة الصورة…');
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const scanner: AnyScanner = new Html5Qrcode('ht-qr-reader', { verbose: false });
      const text = await scanner.scanFile(file, true);
      onScan(text);
      onOpenChange(false);
    } catch {
      setStatus('لم يتم العثور على باركود في الصورة. جرّب صورة أوضح أو المسح بالكاميرا.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>مسح باركود العلبة</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div
            id="ht-qr-reader"
            className="mx-auto min-h-[220px] w-full max-w-[300px] overflow-hidden rounded-xl border bg-black/5"
          />
          {status && <p className="text-sm text-muted-foreground">{status}</p>}
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              اختيار صورة للعلبة
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </div>
          {cameraError && (
            <p className="text-xs text-muted-foreground">
              على الحاسوب استخدم «اختيار صورة». على الهاتف اسمح بالكاميرا عند الطلب.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
