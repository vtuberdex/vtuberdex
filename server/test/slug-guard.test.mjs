import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";

import {
  UPLOADABLE_KINDS,
  removeUploadedImage,
  saveFactionEmblem,
  saveUploadedImage,
} from "../src/uploads.mjs";

const kind = Object.keys(UPLOADABLE_KINDS)[0];
const SLUGS_INVALIDOS = ["../escape", "a/b", "", ["x"], {}];

async function pngBuffer() {
  return sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .png()
    .toBuffer();
}

test("saveUploadedImage rechaza slugs no válidos sin escribir en disco", async () => {
  const imageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slug-guard-"));
  try {
    for (const slug of SLUGS_INVALIDOS) {
      await assert.rejects(
        saveUploadedImage({ buffer: await pngBuffer(), kind, slug, imageRoot, sharp }),
        { message: "slug_invalido" },
      );
    }
    assert.deepEqual(fs.readdirSync(imageRoot), []);
  } finally {
    fs.rmSync(imageRoot, { recursive: true, force: true });
  }
});

test("removeUploadedImage rechaza slugs con separadores o ..", async () => {
  const imageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slug-guard-"));
  try {
    await assert.rejects(removeUploadedImage({ kind, slug: "../escape", imageRoot }), {
      message: "slug_invalido",
    });
  } finally {
    fs.rmSync(imageRoot, { recursive: true, force: true });
  }
});

test("saveFactionEmblem rechaza slugs no válidos", async () => {
  const imageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "slug-guard-"));
  try {
    await assert.rejects(
      saveFactionEmblem({ buffer: await pngBuffer(), slug: ["x"], imageRoot, sharp }),
      { message: "slug_invalido" },
    );
  } finally {
    fs.rmSync(imageRoot, { recursive: true, force: true });
  }
});
