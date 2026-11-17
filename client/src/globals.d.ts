// Определяется вебпаком при сборке
declare const API_URL: string;
declare const BASE_URL: string;
declare const IMAGE_SERVICE_URL: string;
declare const IMAGE_PUBLIC_URL: string;

declare module '*.html' {
  const content: string;
  export default content;
}
