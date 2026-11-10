/**
 * Адрес картинки для письма. publicUrl — публичный адрес ipfs-images
 * (client.imagePublicUrl): письмо открывают вне сети, поэтому адрес должен быть
 * абсолютным; без него — адрес сервиса загрузки, как раньше
 */
export function imageUrl (
  publicUrl: string | undefined, serviceUrl: string, id: string, filename: string
): string {
  const base = (publicUrl || serviceUrl).replace(/\/+$/, '');
  return `${base}/dl/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`;
}

/**
 * Текст ошибки загрузки картинки по ответу ipfs-images
 */
export function imageUploadError (status: number): string {
  if (status === 415) {
    return 'Можно вставлять только картинки PNG, JPEG, GIF или WebP.';
  }
  if (status === 413) {
    return 'Картинка слишком большая.';
  }
  return 'Не удалось загрузить картинку.';
}
