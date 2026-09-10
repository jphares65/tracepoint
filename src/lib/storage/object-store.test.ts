import assert from "node:assert/strict";
import test from "node:test";

import {
  attachmentPathFromMetadata,
  loadSelectedObjectStore,
  ObjectStoreConfigurationError,
  selectStorageProvider,
} from "./object-store-core.ts";
import { SupabaseObjectStore, type SupabaseStorageClient } from "./supabase-object-store.ts";

type Call = {
  bucket: string;
  operation: string;
  path: string;
  options?: unknown;
};

function createClient(calls: Call[]): SupabaseStorageClient {
  return {
    storage: {
      from(bucket) {
        return {
          async upload(path, _body, options) {
            calls.push({ bucket, operation: "upload", path, options });
            return { data: { path }, error: null };
          },
          async remove(paths) {
            calls.push({ bucket, operation: "remove", path: paths[0] });
            return { data: paths, error: null };
          },
          async createSignedUrl(path, expiresIn, options) {
            calls.push({ bucket, operation: "sign", path, options: { expiresIn, ...options } });
            return { data: { signedUrl: "https://signed.invalid/object" }, error: null };
          },
          getPublicUrl(path) {
            calls.push({ bucket, operation: "public-url", path });
            return { data: { publicUrl: `https://public.invalid/${path}` } };
          },
        };
      },
    },
  };
}

const bytes = new Uint8Array([1, 2, 3]);

test("pins attachment operations to the private bucket and preserves path formats", async () => {
  const calls: Call[] = [];
  const store = new SupabaseObjectStore(createClient(calls), "department-a");

  const qualification = await store.uploadQualificationEvidence({
    departmentId: "department-a",
    recordId: "result/a",
    objectId: "object-a",
    fileName: "target  -- photo.png",
    bytes,
    contentType: "image/png",
  });
  const training = await store.uploadTrainingFile({
    departmentId: "department-a",
    recordId: "event-a",
    objectId: "object-b",
    fileName: "lesson plan.pdf",
    bytes,
    contentType: "application/pdf",
  });
  const firearm = await store.uploadFirearmAttachment({
    departmentId: "department-a",
    recordId: "firearm-a",
    objectId: "object-c",
    fileName: "receipt (signed).pdf",
    bytes,
    contentType: "application/pdf",
  });
  const drill = await store.uploadDrillDocument({
    departmentId: "department-a",
    recordId: "drill-template-a",
    objectId: "object-d",
    fileName: "range diagram.webp",
    bytes,
    contentType: "image/webp",
  });

  assert.equal(qualification.path, "department-a/qualification/result%2Fa/object-a-target-photo.png");
  assert.equal(training.path, "department-a/agency-training/event-a/object-b-lesson-plan.pdf");
  assert.equal(firearm.path, "department-a/firearm/firearm-a/object-c-receipt-signed-.pdf");
  assert.equal(drill.path, "department-a/drill-document/drill-template-a/object-d-range-diagram.webp");
  assert.deepEqual(
    calls.map(({ bucket, operation, options }) => ({ bucket, operation, options })),
    [
      { bucket: "tracepoint-attachments", operation: "upload", options: { contentType: "image/png", upsert: false } },
      { bucket: "tracepoint-attachments", operation: "upload", options: { contentType: "application/pdf", upsert: false } },
      { bucket: "tracepoint-attachments", operation: "upload", options: { contentType: "application/pdf", upsert: false } },
      { bucket: "tracepoint-attachments", operation: "upload", options: { contentType: "image/webp", upsert: false } },
    ],
  );
});

test("uses a 60-second attachment download and preserves the download filename", async () => {
  const calls: Call[] = [];
  const store = new SupabaseObjectStore(createClient(calls), "department-a");
  const result = await store.createAttachmentDownload(
    attachmentPathFromMetadata("department-a/firearm/a/object.pdf", "department-a")!,
    "Evidence.pdf",
  );
  assert.equal(result.signedUrl, "https://signed.invalid/object");
  assert.deepEqual(calls[0], {
    bucket: "tracepoint-attachments",
    operation: "sign",
    path: "department-a/firearm/a/object.pdf",
    options: { expiresIn: 60, download: "Evidence.pdf" },
  });
});

test("uses a 60-second inline view without forcing a download", async () => {
  const calls: Call[] = [];
  const store = new SupabaseObjectStore(createClient(calls), "department-a");
  await store.createAttachmentView(
    attachmentPathFromMetadata("department-a/drill-document/drill-a/object.pdf", "department-a")!,
  );
  assert.deepEqual(calls[0], {
    bucket: "tracepoint-attachments",
    operation: "sign",
    path: "department-a/drill-document/drill-a/object.pdf",
    options: { expiresIn: 60 },
  });
});

test("accepts only attachment paths rooted in the authorized department", () => {
  assert.equal(
    attachmentPathFromMetadata(
      "department-a/qualification/result%2Fa/object.png",
      "department-a",
    ),
    "department-a/qualification/result%2Fa/object.png",
  );
  assert.equal(
    attachmentPathFromMetadata(
      "department-a/agency-training/event-a/object.pdf",
      "department-a",
    ),
    "department-a/agency-training/event-a/object.pdf",
  );
  assert.equal(
    attachmentPathFromMetadata(
      "department-a/firearm/firearm-a/object.pdf",
      "department-a",
    ),
    "department-a/firearm/firearm-a/object.pdf",
  );
  assert.equal(
    attachmentPathFromMetadata(
      "department-a/drill-document/drill-a/object.pdf",
      "department-a",
    ),
    "department-a/drill-document/drill-a/object.pdf",
  );
});

test("rejects cross-department, malformed, traversal, and unexpected attachment paths", () => {
  const invalid = [
    "department-b/firearm/firearm-a/object.pdf",
    "firearm/firearm-a/object.pdf",
    "/department-a/firearm/firearm-a/object.pdf",
    "department-a/../firearm/object.pdf",
    "department-a/%2e%2e/firearm/object.pdf",
    "department-a/%252e%252e/firearm/object.pdf",
    "department-a/firearm/%2e%2e/object.pdf",
    "department-a/firearm/firearm-a/%2e%2e",
    "department-a/qualification/result%2F../object.pdf",
    "department-a/qualification/result%252F../object.pdf",
    "department-a/qualification/..%2Fresult/object.pdf",
    "department-a/firearm/firearm%2Fa/object.pdf",
    "department-a/unknown/record/object.pdf",
    "tracepoint-attachments/department-a/firearm/record/object.pdf",
    "https://storage.invalid/department-a/firearm/record/object.pdf",
    "department-a/firearm/record/extra/object.pdf",
    "department-a\\firearm\\record\\object.pdf",
  ];

  for (const path of invalid) {
    assert.equal(
      attachmentPathFromMetadata(path, "department-a"),
      null,
      path,
    );
  }
});

test("pins department patches to the public asset bucket with upsert enabled", async () => {
  const calls: Call[] = [];
  const departmentId = "10000000-0000-4000-8000-000000000001";
  const store = new SupabaseObjectStore(createClient(calls), departmentId);
  const uploaded = await store.uploadDepartmentPatch({
    departmentId,
    extension: "webp",
    bytes,
    contentType: "image/webp",
    timestamp: 1234,
  });
  const publicUrl = (await store.createDepartmentPatchDelivery(uploaded.path)).signedUrl;
  await store.removeDepartmentPatch(uploaded.path);

  assert.equal(uploaded.path, `${departmentId}/patch-1234.webp`);
  assert.equal(publicUrl, `https://public.invalid/${departmentId}/patch-1234.webp`);
  assert.deepEqual(calls, [
    {
      bucket: "department-assets",
      operation: "upload",
      path: `${departmentId}/patch-1234.webp`,
      options: { contentType: "image/webp", upsert: true },
    },
    { bucket: "department-assets", operation: "public-url", path: `${departmentId}/patch-1234.webp` },
    { bucket: "department-assets", operation: "remove", path: `${departmentId}/patch-1234.webp` },
  ]);
});

test("provider selection fails closed and permits Supabase only in explicit bridge mode", () => {
  assert.equal(selectStorageProvider({ TRACEPOINT_RUNTIME_PROVIDER_MODE: "aws-native", TRACEPOINT_STORAGE_PROVIDER: "s3" }), "s3");
  assert.equal(selectStorageProvider({ TRACEPOINT_RUNTIME_PROVIDER_MODE: "bridge", TRACEPOINT_STORAGE_PROVIDER: "s3" }), "s3");
  assert.equal(selectStorageProvider({ TRACEPOINT_RUNTIME_PROVIDER_MODE: "bridge", TRACEPOINT_STORAGE_PROVIDER: "supabase" }), "supabase");
  for (const environment of [
    {},
    { TRACEPOINT_RUNTIME_PROVIDER_MODE: "aws-native", TRACEPOINT_STORAGE_PROVIDER: "supabase" },
    { TRACEPOINT_RUNTIME_PROVIDER_MODE: "bridge" },
    { TRACEPOINT_RUNTIME_PROVIDER_MODE: "rollback", TRACEPOINT_STORAGE_PROVIDER: "supabase" },
  ]) {
    assert.throws(() => selectStorageProvider(environment), ObjectStoreConfigurationError);
  }
});

test("aws-native selection cannot resolve or call Supabase Storage", async () => {
  let supabaseResolved = false;
  let storageAccessed = false;
  const legacyClient = Object.defineProperty({}, "storage", {
    get() {
      storageAccessed = true;
      throw new Error("Supabase Storage was accessed");
    },
  });
  const s3Store = {} as never;
  const selected = await loadSelectedObjectStore(
    { TRACEPOINT_RUNTIME_PROVIDER_MODE: "aws-native", TRACEPOINT_STORAGE_PROVIDER: "s3" },
    {
      s3: () => s3Store,
      supabase: () => {
        supabaseResolved = true;
        void (legacyClient as SupabaseStorageClient).storage;
        throw new Error("Supabase Storage was resolved");
      },
    },
  );
  assert.equal(selected, s3Store);
  assert.equal(supabaseResolved, false);
  assert.equal(storageAccessed, false);
});
