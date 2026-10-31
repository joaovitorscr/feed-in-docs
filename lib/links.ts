import { createHash } from "node:crypto";
import { get, put } from "@vercel/blob";

const ID_PATTERN = /^[a-f0-9]{16}$/;

function blobPath(id: string) {
  return `llms/${id}.txt`;
}

/** Saves the index under an ID derived from its source, so regenerating refreshes the same link. */
export async function saveLlmsTxt(text: string, source: string) {
  const id = createHash("sha256").update(source).digest("hex").slice(0, 16);
  try {
    await put(blobPath(id), text, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      contentType: "text/plain; charset=utf-8",
    });
    return id;
  } catch (error) {
    // The generated text is still usable, so a storage failure only costs the link.
    console.error("Could not save llms.txt", error);
    return null;
  }
}

export async function readLlmsTxt(id: string) {
  if (!ID_PATTERN.test(id)) return null;
  const result = await get(blobPath(id), { access: "private" });
  return result?.statusCode === 200 ? result.stream : null;
}
