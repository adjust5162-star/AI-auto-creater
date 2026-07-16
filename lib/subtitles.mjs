export function scenesToSrt(scenes) {
  return [...scenes]
    .sort((a, b) => a.index - b.index)
    .map((scene, index) => {
      return `${index + 1}\n${formatSrtTime(scene.start)} --> ${formatSrtTime(scene.end)}\n${wrapSubtitle(scene.narration)}\n`;
    })
    .join("\n");
}

export function scenesToVtt(scenes) {
  const entries = [...scenes]
    .sort((a, b) => a.index - b.index)
    .map((scene) => `${formatVttTime(scene.start)} --> ${formatVttTime(scene.end)}\n${wrapSubtitle(scene.narration)}\n`)
    .join("\n");
  return `WEBVTT\n\n${entries}`;
}

export function formatSrtTime(seconds) {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const wholeSeconds = Math.floor(safeSeconds % 60);
  const milliseconds = Math.round((safeSeconds - Math.floor(safeSeconds)) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(wholeSeconds)},${String(milliseconds).padStart(3, "0")}`;
}

function formatVttTime(seconds) {
  return formatSrtTime(seconds).replace(",", ".");
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function wrapSubtitle(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= 58) return normalized;

  const words = normalized.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > 58 && current) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3).join("\n");
}
