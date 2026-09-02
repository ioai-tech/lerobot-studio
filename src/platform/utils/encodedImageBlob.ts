import {
  mimeTypeForImageFormat,
  renderTiffDepthPreview,
  sniffImageFormat,
  type DepthPreview,
} from '@/core';

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

function imageDataFromPreview(preview: DepthPreview): ImageData {
  const imageData = new ImageData(preview.width, preview.height);
  imageData.data.set(preview.rgba);
  return imageData;
}

export async function encodedImageToBlob(bytes: Uint8Array): Promise<Blob> {
  const format = sniffImageFormat(bytes);
  if (format === 'tiff') {
    const preview = renderTiffDepthPreview(bytes);
    const canvas = document.createElement('canvas');
    canvas.width = preview.width;
    canvas.height = preview.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Cannot create canvas context for depth preview');
    }
    context.putImageData(imageDataFromPreview(preview), 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Failed to encode depth preview PNG'));
      }, 'image/png');
    });
    return png;
  }
  return new Blob([copyBytes(bytes)], { type: mimeTypeForImageFormat(format) });
}

export async function encodedImageToBitmap(bytes: Uint8Array): Promise<ImageBitmap> {
  const format = sniffImageFormat(bytes);
  if (format === 'tiff') {
    return createImageBitmap(imageDataFromPreview(renderTiffDepthPreview(bytes)));
  }
  return createImageBitmap(await encodedImageToBlob(bytes));
}
