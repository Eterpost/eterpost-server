import { imageUploadError, imageUrl } from './imageUrl';


/**
 * Загружает картинку письма в ipfs-images и возвращает её адрес для письма.
 * Отказ — Error с текстом для пользователя
 */
export async function uploadImage (file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  let response: Response;
  try {
    response = await fetch(IMAGE_SERVICE_URL + '/ul', { body: form, method: 'POST' });
  } catch (error) {
    throw new Error(imageUploadError(0), { cause: error });
  }
  if (!response.ok) {
    throw new Error(imageUploadError(response.status));
  }
  const { id } = await response.json();
  return imageUrl(IMAGE_PUBLIC_URL, IMAGE_SERVICE_URL, id, file.name);
}
