/// <reference types="vite/client" />
declare module 'heic2any' {
  export default function convert(options: {
    blob: Blob;
    toType: string;
  }): Promise<Blob | Blob[]>;
}
