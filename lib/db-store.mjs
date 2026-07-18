const projectTable = "aiac_projects";
const jobTable = "aiac_jobs";
const assetBucket = "aiac-assets";
let assetBucketReady = false;

export function hasSupabaseStore() {
  return Boolean(getSupabaseUrl() && getSupabaseKey());
}

export async function listProjectsFromDb() {
  const rows = await supabaseFetch(
    `/${projectTable}?select=id,project,updated_at&order=updated_at.desc`,
    { method: "GET" }
  );
  return rows.map((row) => row.project).filter(Boolean);
}

export async function getProjectFromDb(projectId) {
  const rows = await supabaseFetch(
    `/${projectTable}?id=eq.${encodeURIComponent(projectId)}&select=project&limit=1`,
    { method: "GET" }
  );
  if (!rows[0]?.project) throw new Error("Project not found.");
  return rows[0].project;
}

export async function saveProjectToDb(project) {
  await supabaseFetch(`/${projectTable}?on_conflict=id`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify({
      id: project.id,
      project,
      status: project.status,
      updated_at: project.updatedAt || new Date().toISOString()
    })
  });
}

export async function getJobFromDb(jobId) {
  const rows = await supabaseFetch(
    `/${jobTable}?id=eq.${encodeURIComponent(jobId)}&select=job&limit=1`,
    { method: "GET" }
  );
  if (!rows[0]?.job) throw new Error("Job not found.");
  return rows[0].job;
}

export async function saveJobToDb(job) {
  await supabaseFetch(`/${jobTable}?on_conflict=id`, {
    method: "POST",
    headers: {
      Prefer: "resolution=merge-duplicates"
    },
    body: JSON.stringify({
      id: job.id,
      project_id: job.projectId,
      job,
      status: job.status,
      updated_at: job.updatedAt || new Date().toISOString()
    })
  });
}

export async function uploadAssetObject(storagePath, buffer, contentType) {
  await ensureAssetBucket();
  await supabaseStorageFetch(`/object/${assetBucket}/${encodeStoragePath(storagePath)}`, {
    method: "POST",
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true"
    },
    body: buffer
  });
}

export async function downloadAssetObject(storagePath) {
  const response = await supabaseRawFetch(`/storage/v1/object/${assetBucket}/${encodeStoragePath(storagePath)}`, {
    method: "GET"
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase asset download failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function supabaseFetch(path, options) {
  const response = await supabaseRawFetch(`/rest/v1${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase request failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function supabaseStorageFetch(path, options) {
  const response = await supabaseRawFetch(`/storage/v1${path}`, options);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase Storage request failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function supabaseRawFetch(path, options) {
  const url = `${getSupabaseUrl()}${path}`;
  const key = getSupabaseKey();
  return fetch(url, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      ...(options.headers || {})
    }
  });
}

async function ensureAssetBucket() {
  if (assetBucketReady) return;
  const response = await supabaseRawFetch("/storage/v1/bucket", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: assetBucket, name: assetBucket, public: false })
  });
  if (!response.ok && response.status !== 400 && response.status !== 409) {
    const text = await response.text();
    throw new Error(`Supabase asset bucket setup failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  assetBucketReady = true;
}

function encodeStoragePath(storagePath) {
  return String(storagePath || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function getSupabaseUrl() {
  return process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
}

function getSupabaseKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVER_KEY || "";
}
