const state = {
  projects: [],
  selectedProject: null,
  selectedJob: null,
  pollTimer: null
};

const labels = {
  educational: "교육",
  news: "뉴스 요약",
  product: "제품 소개",
  healthcare: "헬스케어",
  shorts: "숏폼",
  slideshow: "슬라이드쇼"
};

const statusLabels = {
  draft: "초안",
  rendering: "렌더링",
  completed: "완료",
  failed: "실패",
  queued: "대기",
  running: "진행"
};

document.querySelector("#project-form").addEventListener("submit", createProject);
document.querySelector("#refresh-projects").addEventListener("click", () => refreshProjects(state.selectedProject?.id));

await refreshProjects();

async function refreshProjects(selectId) {
  const response = await fetch("/api/projects", { cache: "no-store" });
  const data = await response.json();
  state.projects = (data.projects || []).map(normalizeProjectForUi);
  state.selectedProject =
    state.projects.find((project) => project.id === selectId) ||
    state.projects.find((project) => project.id === state.selectedProject?.id) ||
    state.projects[0] ||
    null;
  renderMetrics();
  renderProjectList();
  renderStudio();
  startPolling();
}

async function createProject(event) {
  event.preventDefault();
  clearMessage();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  button.disabled = true;
  button.textContent = "생성 중";
  try {
    const payload = await formToJson(form);
    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "프로젝트 생성에 실패했습니다.");
    form.reset();
    form.targetDuration.value = "45";
    form.brandColor.value = "#146ef5";
    showMessage("프로젝트를 만들었습니다.", "success");
    await refreshProjects(data.project.id);
  } catch (error) {
    showMessage(error.message || "프로젝트 생성에 실패했습니다.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "생성";
  }
}

async function formToJson(form) {
  const data = new FormData(form);
  const assets = [];
  for (const key of ["image", "audio"]) {
    const file = data.get(key);
    if (file instanceof File && file.size > 0) {
      assets.push(await fileToJson(file));
    }
  }

  return {
    title: data.get("title"),
    contentType: data.get("contentType"),
    aspectRatio: data.get("aspectRatio"),
    targetDuration: data.get("targetDuration"),
    sourceText: data.get("sourceText"),
    sourceUrl: data.get("sourceUrl"),
    voice: data.get("voice"),
    subtitlePreset: data.get("subtitlePreset"),
    backgroundMusic: data.get("backgroundMusic") || "none",
    brandColor: data.get("brandColor"),
    assets
  };
}

function fileToJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        name: file.name,
        type: file.type,
        data: reader.result
      });
    };
    reader.onerror = () => reject(reader.error || new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function renderMetrics() {
  const metrics = [
    ["전체", state.projects.length],
    ["렌더링", state.projects.filter((project) => project.status === "rendering").length],
    ["완료", state.projects.filter((project) => project.status === "completed").length],
    ["실패", state.projects.filter((project) => project.status === "failed").length]
  ];
  document.querySelector("#metrics").innerHTML = metrics
    .map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function renderProjectList() {
  const container = document.querySelector("#project-list");
  if (!state.projects.length) {
    container.innerHTML = `<p class="muted">아직 프로젝트가 없습니다.</p>`;
    return;
  }
  container.innerHTML = state.projects
    .map(
      (project) => `
        <button class="project-item ${state.selectedProject?.id === project.id ? "active" : ""}" data-project-id="${project.id}" type="button">
          <div class="item-top">
            <div>
              <div class="project-title">${escapeHtml(project.title)}</div>
              <div class="project-subtitle">${labels[project.contentType]} · ${project.aspectRatio === "vertical" ? "9:16" : "16:9"}</div>
            </div>
            ${statusPill(project.status)}
          </div>
        </button>
      `
    )
    .join("");

  container.querySelectorAll("[data-project-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedProject = state.projects.find((project) => project.id === button.dataset.projectId) || null;
      state.selectedJob = null;
      renderProjectList();
      renderStudio();
      startPolling();
    });
  });
}

function normalizeProjectForUi(project) {
  const title = recoverProjectTitle(project);
  return title === project.title ? project : { ...project, title };
}

function recoverProjectTitle(project) {
  const title = String(project?.title || "").trim();
  if (title && !hasBrokenText(title)) return title;

  const scenes = Array.isArray(project?.scenes) ? [...project.scenes].sort((a, b) => a.index - b.index) : [];
  const headline = stripBrokenText(scenes[0]?.headline || "").replace(/^핵심:\s*/, "");
  if (headline) return headline;

  const cleanedTitle = stripBrokenText(title);
  return cleanedTitle || "제목 없는 프로젝트";
}

function hasBrokenText(value) {
  return /\?{2,}|\uFFFD/.test(String(value || ""));
}

function stripBrokenText(value) {
  return String(value || "")
    .replace(/\s*\?{2,}\s*/g, " ")
    .replace(/\uFFFD/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function renderStudio() {
  const root = document.querySelector("#studio");
  const project = state.selectedProject;
  if (!project) {
    root.innerHTML = `<div class="empty-state"><div><div class="empty-icon">▶</div><h2>프로젝트를 선택하세요</h2></div></div>`;
    return;
  }

  const scenes = [...project.scenes].sort((a, b) => a.index - b.index);
  const totalDuration = scenes.reduce((sum, scene) => sum + Number(scene.duration || 0), 0);
  root.innerHTML = `
    <div class="workspace-head">
      <div>
        <div class="button-row">
          ${statusPill(project.status)}
          <span class="status draft">${project.aiProvider === "openrouter" ? "OpenRouter" : "Local"}</span>
          <span class="status draft">${project.aspectRatio === "vertical" ? "1080x1920" : "1920x1080"}</span>
        </div>
        <input class="project-name-input" id="project-title" value="${escapeAttribute(project.title)}" aria-label="프로젝트 제목" />
        <p class="muted">${scenes.length}개 씬 · ${Math.round(totalDuration)}초 · ${labels[project.contentType]}</p>
        ${project.aiWarning ? `<p class="warning">${escapeHtml(project.aiWarning)}</p>` : ""}
      </div>
      <div class="button-row">
        <button class="secondary-button" id="save-project" type="button">저장</button>
        <button class="dark-button" id="render-project" type="button" ${isActiveJob() ? "disabled" : ""}>렌더</button>
      </div>
    </div>
    <div class="studio-grid">
      <div>
        <div class="section-title"><span class="icon-square">S</span><h2>씬 편집</h2></div>
        <div class="scene-list">
          ${scenes.map((scene, index) => sceneEditor(project, scene, index, scenes.length)).join("")}
        </div>
      </div>
      <div class="side-stack">
        ${renderPanel(project, state.selectedJob)}
        ${assetsPanel(project)}
      </div>
    </div>
  `;

  root.querySelector("#project-title").addEventListener("input", (event) => {
    project.title = event.target.value;
  });
  root.querySelector("#save-project").addEventListener("click", saveSelectedProject);
  root.querySelector("#render-project").addEventListener("click", renderSelectedProject);
  root.querySelectorAll("[data-scene-id]").forEach((card) => bindSceneCard(card, project));
}

function sceneEditor(project, scene, index, total) {
  const images = project.assets.filter((asset) => asset.kind === "image");
  return `
    <article class="scene-card" data-scene-id="${scene.id}">
      <div class="scene-head">
        <div class="button-row">
          <span class="scene-number">${scene.index}</span>
          <input class="scene-title-input" data-field="headline" value="${escapeAttribute(scene.headline)}" aria-label="씬 ${scene.index} 헤드라인" />
        </div>
        <div class="button-row">
          <button class="icon-button" data-action="up" type="button" title="위로" ${index === 0 ? "disabled" : ""}>↑</button>
          <button class="icon-button" data-action="down" type="button" title="아래로" ${index === total - 1 ? "disabled" : ""}>↓</button>
          <button class="secondary-button" data-action="regenerate" type="button">재생성</button>
        </div>
      </div>
      <label>
        내레이션
        <textarea data-field="narration" rows="4">${escapeHtml(scene.narration)}</textarea>
      </label>
      <div class="scene-options">
        <label>
          길이
          <input data-field="duration" type="number" min="3" max="45" value="${scene.duration}" />
        </label>
        <label>
          이미지
          <select data-field="assetId">
            <option value="">자동</option>
            ${images
              .map((asset) => `<option value="${asset.id}" ${scene.assetId === asset.id ? "selected" : ""}>${escapeHtml(asset.originalName)}</option>`)
              .join("")}
          </select>
        </label>
        <label>
          전환
          <select data-field="transition">
            <option value="cut" ${scene.transition === "cut" ? "selected" : ""}>Cut</option>
            <option value="fade" ${scene.transition === "fade" ? "selected" : ""}>Fade</option>
          </select>
        </label>
        <label>
          카메라
          <select data-field="cameraMovement">
            <option value="none" ${scene.cameraMovement === "none" ? "selected" : ""}>None</option>
            <option value="slow-zoom" ${scene.cameraMovement === "slow-zoom" ? "selected" : ""}>Slow Zoom</option>
            <option value="pan-left" ${scene.cameraMovement === "pan-left" ? "selected" : ""}>Pan Left</option>
            <option value="pan-right" ${scene.cameraMovement === "pan-right" ? "selected" : ""}>Pan Right</option>
          </select>
        </label>
      </div>
      <label>
        강조 단어
        <input data-field="highlightedWords" value="${escapeAttribute((scene.highlightedWords || []).join(", "))}" />
      </label>
    </article>
  `;
}

function bindSceneCard(card, project) {
  const sceneId = card.dataset.sceneId;
  card.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      const scene = project.scenes.find((item) => item.id === sceneId);
      const field = input.dataset.field;
      if (!scene) return;
      if (field === "duration") scene.duration = clamp(Number(input.value), 3, 45);
      else if (field === "highlightedWords") scene.highlightedWords = input.value.split(",").map((word) => word.trim()).filter(Boolean);
      else if (field === "assetId") scene.assetId = input.value || undefined;
      else scene[field] = input.value;
      project.scenes = retimeLocal(project.scenes);
    });
  });
  card.querySelector("[data-action='up']")?.addEventListener("click", () => moveScene(sceneId, -1));
  card.querySelector("[data-action='down']")?.addEventListener("click", () => moveScene(sceneId, 1));
  card.querySelector("[data-action='regenerate']")?.addEventListener("click", () => regenerateSelectedScene(sceneId));
}

async function saveSelectedProject() {
  const project = state.selectedProject;
  if (!project) return null;
  clearMessage();
  project.scenes = retimeLocal(project.scenes);
  const response = await fetch(`/api/projects/${project.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: project.title,
      targetDuration: project.targetDuration,
      brandColor: project.brandColor,
      scenes: project.scenes
    })
  });
  const data = await response.json();
  if (!response.ok) {
    showMessage(data.error || "저장에 실패했습니다.", "error");
    return null;
  }
  state.selectedProject = data.project;
  showMessage("저장했습니다.", "success");
  await refreshProjects(data.project.id);
  return data.project;
}

async function renderSelectedProject() {
  const saved = await saveSelectedProject();
  if (!saved) return;
  const response = await fetch(`/api/projects/${saved.id}/render`, { method: "POST" });
  const data = await response.json();
  if (!response.ok) {
    showMessage(data.error || "렌더링을 시작하지 못했습니다.", "error");
    return;
  }
  state.selectedJob = data.job;
  state.selectedProject = { ...saved, status: "rendering", latestJobId: data.job.id };
  showMessage("렌더링을 시작했습니다.", "success");
  renderStudio();
  startPolling();
}

async function regenerateSelectedScene(sceneId) {
  const project = await saveSelectedProject();
  if (!project) return;
  const response = await fetch(`/api/projects/${project.id}/regenerate-scene`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sceneId })
  });
  const data = await response.json();
  if (!response.ok) {
    showMessage(data.error || "씬 재생성에 실패했습니다.", "error");
    return;
  }
  state.selectedProject = data.project;
  showMessage("씬을 다시 생성했습니다.", "success");
  await refreshProjects(data.project.id);
}

function moveScene(sceneId, direction) {
  const project = state.selectedProject;
  if (!project) return;
  const scenes = [...project.scenes].sort((a, b) => a.index - b.index);
  const current = scenes.findIndex((scene) => scene.id === sceneId);
  const next = current + direction;
  if (current < 0 || next < 0 || next >= scenes.length) return;
  const [scene] = scenes.splice(current, 1);
  scenes.splice(next, 0, scene);
  project.scenes = retimeLocal(scenes);
  renderStudio();
}

function renderPanel(project, job) {
  if (!job) {
    return `
      <section class="panel">
        <div class="section-title"><span class="icon-square">R</span><h2>렌더 상태</h2></div>
        <p class="muted">${project.status === "draft" ? "렌더 대기 중입니다." : "렌더 기록을 불러오는 중입니다."}</p>
      </section>
    `;
  }

  const output = job.output;
  return `
    <section class="panel">
      <div class="section-title"><span class="icon-square">R</span><h2>렌더 상태</h2></div>
      <div class="render-stack">
        <div class="item-top">
          <div>
            <strong>${escapeHtml(job.stage)}</strong>
            ${job.error ? `<p class="warning">${escapeHtml(job.error)}</p>` : ""}
          </div>
          ${statusPill(job.status === "completed" ? "completed" : job.status === "failed" ? "failed" : "rendering")}
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.max(0, Math.min(100, job.progress || 0))}%"></div></div>
        ${(job.warnings || []).map((warning) => `<p class="warning">${escapeHtml(warning)}</p>`).join("")}
        ${
          output
            ? `
          <video controls src="${output.videoUrl}">
            <track kind="subtitles" srclang="ko" label="Korean" src="${output.vttUrl}" default>
          </video>
          <div class="meta-grid">
            <div class="meta"><span>길이</span><strong>${Math.round(output.duration)}초</strong></div>
            <div class="meta"><span>해상도</span><strong>${output.resolution}</strong></div>
            <div class="meta"><span>용량</span><strong>${formatBytes(output.fileSize || 0)}</strong></div>
          </div>
          <div class="download-grid">
            <a class="download-button" href="${output.videoUrl}" download>MP4</a>
            <a class="download-button" href="${output.srtUrl}" download>SRT</a>
            <a class="download-button" href="${output.projectJsonUrl}" download>JSON</a>
          </div>
        `
            : ""
        }
      </div>
    </section>
  `;
}

function assetsPanel(project) {
  if (!project.assets.length) {
    return `
      <section class="panel">
        <div class="section-title"><span class="icon-square">A</span><h2>에셋</h2></div>
        <p class="muted">업로드된 에셋이 없습니다.</p>
      </section>
    `;
  }
  return `
    <section class="panel">
      <div class="section-title"><span class="icon-square">A</span><h2>에셋</h2></div>
      <div class="asset-list">
        ${project.assets
          .map(
            (asset) => `
            <div class="asset-item">
              <strong>${escapeHtml(asset.originalName)}</strong>
              <div class="muted">${asset.kind} · ${formatBytes(asset.size)}</div>
            </div>
          `
          )
          .join("")}
      </div>
    </section>
  `;
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  if (!state.selectedProject?.latestJobId) return;

  const load = async () => {
    const response = await fetch(`/api/jobs/${state.selectedProject.latestJobId}`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    state.selectedJob = data.job;
    renderStudio();
    if (data.job.status === "completed" || data.job.status === "failed") {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
      await refreshProjects(state.selectedProject.id);
    }
  };
  load();
  state.pollTimer = setInterval(load, 1800);
}

function isActiveJob() {
  return state.selectedJob?.status === "queued" || state.selectedJob?.status === "running";
}

function statusPill(status) {
  const mapped = status === "queued" || status === "running" ? "rendering" : status;
  return `<span class="status ${mapped}">${statusLabels[status] || statusLabels[mapped] || status}</span>`;
}

function retimeLocal(scenes) {
  let start = 0;
  return [...scenes]
    .map((scene, index) => ({ ...scene, index: index + 1 }))
    .map((scene) => {
      const duration = clamp(Number(scene.duration) || 3, 3, 45);
      const next = { ...scene, duration, start, end: start + duration };
      start = next.end;
      return next;
    });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatBytes(bytes) {
  if (!bytes) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function showMessage(text, type) {
  const message = document.querySelector("#message");
  message.textContent = text;
  message.className = `message ${type}`;
}

function clearMessage() {
  const message = document.querySelector("#message");
  message.textContent = "";
  message.className = "message hidden";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
