import { spawn } from 'node:child_process';

export const getYtdlpPath = () => process.env.YTDLP_PATH || 'yt-dlp';

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Spawn yt-dlp with the given args, collect stdout, reject on non-zero exit.
 * Never uses shell: true.
 */
const run = (args) =>
  new Promise((resolve, reject) => {
    const proc = spawn(getYtdlpPath(), args, { shell: false });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`yt-dlp exited ${code}: ${stderr.trim().slice(0, 300)}`));
      else resolve(stdout);
    });
    proc.on('error', (err) => reject(new Error(`yt-dlp spawn error: ${err.message}`)));
  });

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyse a single URL.
 * Returns: { title, duration, extractor, thumbnail, formats }
 * formats: [{ format_id, ext, resolution, fps, tbr, acodec, vcodec, filesize }]
 */
export const analyseUrl = async (url) => {
  const raw = await run(['-j', '--no-playlist', url]);

  // yt-dlp may print info/warning lines before the JSON object.
  // Find the last line that starts with '{' — that is the metadata JSON.
  const jsonLine = raw.split('\n').filter((l) => l.trim().startsWith('{')).pop();
  let data;
  try {
    if (!jsonLine) throw new Error('no JSON line found');
    data = JSON.parse(jsonLine);
  } catch {
    throw new Error('Failed to parse yt-dlp JSON output');
  }

  const formats = (data.formats || []).map((f) => ({
    format_id:   f.format_id,
    ext:         f.ext,
    resolution:  f.resolution || (f.width && f.height ? `${f.width}x${f.height}` : 'audio only'),
    fps:         f.fps    ?? null,
    tbr:         f.tbr    ?? null,
    acodec:      f.acodec || 'none',
    vcodec:      f.vcodec || 'none',
    filesize:    f.filesize || f.filesize_approx || null,
    format_note: f.format_note || null,
  }));

  return {
    title:     data.title,
    duration:  data.duration ?? null,
    extractor: data.extractor,
    thumbnail: data.thumbnail ?? null,
    formats,
  };
};

/**
 * Fetch playlist entries (flat, no individual video metadata).
 * Returns: { title, entries: [{ id, title, duration, duration_string, url }] }
 */
export const fetchPlaylist = async (url, maxEntries = 0) => {
  const args = ['--flat-playlist', '-J'];
  if (maxEntries > 0) args.push('--playlist-end', String(maxEntries));
  args.push(url);
  const raw = await run(args);

  // -J outputs a (possibly multi-line) JSON object that may be preceded by
  // info/warning lines. Skip forward to the first '{' to find the JSON start.
  const jsonStart = raw.indexOf('{');
  let data;
  try {
    if (jsonStart === -1) throw new Error('no JSON object found in output');
    data = JSON.parse(raw.slice(jsonStart));
  } catch {
    throw new Error('Failed to parse yt-dlp playlist JSON output');
  }

  const entries = (data.entries || []).map((e) => ({
    id:              e.id,
    title:           e.title,
    duration:        e.duration        ?? null,
    duration_string: e.duration_string ?? null,
    url:             e.url || e.webpage_url || `https://www.youtube.com/watch?v=${e.id}`,
  }));

  return { title: data.title, entries };
};

// Progress template written to stdout by yt-dlp for each download tick.
// Lines starting with YTDLP_JSON are parsed by downloadQueue._spawn.
export const PROGRESS_TEMPLATE =
  'download:YTDLP_JSON {"pct":%(progress.downloaded_bytes)s,' +
  '"total":%(progress.total_bytes)s,' +
  '"est":%(progress.total_bytes_estimate)s,' +
  '"spd":%(progress.speed)s,' +
  '"eta":%(progress.eta)s,' +
  '"frag_i":%(progress.fragment_index)s,' +
  '"frag_n":%(progress.fragment_count)s}';

/**
 * Build the full yt-dlp argument array for a download_jobs row.
 * job:      download_jobs DB row
 * settings: { default_format_spec, default_download_path }
 * Never uses shell: true — args are a plain array.
 */
export const buildArgs = (job, settings) => {
  const formatSpec = job.format_spec || settings.default_format_spec;
  const outputDir  = job.output_dir  || settings.default_download_path;
  const outputPath = job.subfolder
    ? `${outputDir}/${job.subfolder}/%(title)s.%(ext)s`
    : `${outputDir}/%(title)s.%(ext)s`;

  return [
    '--newline',
    '--progress-template', PROGRESS_TEMPLATE,
    '-f', formatSpec,
    '-o', outputPath,
    '--print', 'after_move:%(filepath)s',
    '--no-simulate',
    job.url,
  ];
};
