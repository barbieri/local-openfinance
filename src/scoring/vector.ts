export function vectorToBlob(vector: readonly number[]): Buffer {
  const buffer = Buffer.alloc(vector.length * 4);
  for (let index = 0; index < vector.length; index += 1) {
    buffer.writeFloatLE(vector[index] ?? 0, index * 4);
  }
  return buffer;
}

export function blobToVector(blob: Buffer, dimensions: number): Float32Array {
  if (blob.byteLength !== dimensions * 4) {
    throw new Error(`Expected ${dimensions * 4} bytes in embedding blob, got ${blob.byteLength}`);
  }
  return new Float32Array(blob.buffer, blob.byteOffset, dimensions);
}

export function cosineSimilarity(
  left: Float32Array | readonly number[],
  right: Float32Array | readonly number[],
): number {
  let dot = 0;
  let normLeft = 0;
  let normRight = 0;

  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    normLeft += a * a;
    normRight += b * b;
  }

  if (normLeft === 0 || normRight === 0) {
    return 0;
  }

  return dot / (Math.sqrt(normLeft) * Math.sqrt(normRight));
}
