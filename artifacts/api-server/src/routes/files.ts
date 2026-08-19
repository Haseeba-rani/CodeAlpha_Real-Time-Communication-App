import { Router, type IRouter, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const router: IRouter = Router();

// Base uploads directory in workspace
const UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

// Ensure base upload directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * POST /meetings/:meetingId/files/upload
 * Handles streaming upload of shared files for a meeting room.
 */
router.post("/meetings/:meetingId/files/upload", async (req: Request, res: Response): Promise<void> => {
  const meetingId = typeof req.params.meetingId === "string" ? req.params.meetingId : Array.isArray(req.params.meetingId) ? req.params.meetingId[0] : "";

  if (!meetingId) {
    res.status(400).json({ error: "Missing meetingId" });
    return;
  }

  const rawFileName = (req.headers["x-file-name"] as string) || "shared_file";
  let fileName = "shared_file";
  try {
    fileName = decodeURIComponent(rawFileName);
  } catch {
    fileName = rawFileName;
  }

  const fileType = (req.headers["x-file-type"] as string) || "application/octet-stream";
  const fileSizeHeader = parseInt((req.headers["x-file-size"] as string) || "0", 10);
  const uploaderId = (req.headers["x-uploader-id"] as string) || "guest";
  const rawUploaderName = (req.headers["x-uploader-name"] as string) || "Participant";
  let uploaderName = "Participant";
  try {
    uploaderName = decodeURIComponent(rawUploaderName);
  } catch {
    uploaderName = rawUploaderName;
  }

  const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
  if (fileSizeHeader > MAX_SIZE) {
    res.status(413).json({ error: "File too large. Maximum allowed is 50 MB." });
    return;
  }

  const fileId = `file_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const sanitizedName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const meetingUploadsDir = path.join(UPLOADS_DIR, meetingId);

  try {
    if (!fs.existsSync(meetingUploadsDir)) {
      fs.mkdirSync(meetingUploadsDir, { recursive: true });
    }

    const targetFilePath = path.join(meetingUploadsDir, `${fileId}_${sanitizedName}`);
    const writeStream = fs.createWriteStream(targetFilePath);

    // Stream raw incoming payload to disk
    await pipeline(req, writeStream);

    const stats = fs.statSync(targetFilePath);
    const actualSize = stats.size || fileSizeHeader;

    // Save metadata sidecar file for download lookup
    const metaFilePath = path.join(meetingUploadsDir, `${fileId}.meta.json`);
    const metadata = {
      id: fileId,
      meetingId,
      fileName,
      fileSize: actualSize,
      fileType,
      uploaderId,
      uploaderName,
      storagePath: targetFilePath,
      downloadUrl: `/api/meetings/${meetingId}/files/${fileId}/download`,
      createdAt: new Date().toISOString(),
    };

    fs.writeFileSync(metaFilePath, JSON.stringify(metadata, null, 2), "utf-8");

    res.status(201).json(metadata);
  } catch (err) {
    console.error(`[File Upload Error] Meeting ${meetingId}:`, err);
    res.status(500).json({ error: "Failed to process and store file upload." });
  }
});

/**
 * GET /meetings/:meetingId/files/:fileId/download
 * Serves the file for download.
 */
router.get("/meetings/:meetingId/files/:fileId/download", (req: Request, res: Response): void => {
  const meetingId = typeof req.params.meetingId === "string" ? req.params.meetingId : Array.isArray(req.params.meetingId) ? req.params.meetingId[0] : "";
  const fileId = typeof req.params.fileId === "string" ? req.params.fileId : Array.isArray(req.params.fileId) ? req.params.fileId[0] : "";

  if (!meetingId || !fileId) {
    res.status(400).json({ error: "Missing meetingId or fileId" });
    return;
  }

  const meetingUploadsDir = path.join(UPLOADS_DIR, meetingId);
  const metaFilePath = path.join(meetingUploadsDir, `${fileId}.meta.json`);

  if (!fs.existsSync(metaFilePath)) {
    res.status(404).json({ error: "File not found or expired." });
    return;
  }

  try {
    const metaContent = fs.readFileSync(metaFilePath, "utf-8");
    const metadata = JSON.parse(metaContent);

    if (!fs.existsSync(metadata.storagePath)) {
      res.status(404).json({ error: "Physical file is missing from storage." });
      return;
    }

    res.download(metadata.storagePath, metadata.fileName, (err) => {
      if (err) {
        console.error(`[File Download Error] ${fileId}:`, err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Could not stream file." });
        }
      }
    });
  } catch (err) {
    console.error(`[Metadata Read Error] ${fileId}:`, err);
    res.status(500).json({ error: "Internal server error." });
  }
});

export default router;
