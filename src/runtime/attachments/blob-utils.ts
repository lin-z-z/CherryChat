export async function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  const maybeArrayBuffer = (
    blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }
  ).arrayBuffer;
  if (typeof maybeArrayBuffer === "function") {
    return new Uint8Array(await maybeArrayBuffer.call(blob));
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("Unable to read attachment"));
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error("Unable to read attachment bytes"));
        return;
      }
      resolve(new Uint8Array(reader.result));
    };
    reader.readAsArrayBuffer(blob);
  });
}

export async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Blob(blob: Blob): Promise<string> {
  return sha256Bytes(await readBlobBytes(blob));
}

export async function blobToDataUrl(
  blob: Blob,
  mimeType: string,
): Promise<string> {
  const bytes = await readBlobBytes(blob);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}
