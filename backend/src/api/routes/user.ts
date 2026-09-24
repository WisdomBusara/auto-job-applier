import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { db } from "../../db/index.js";
import { EMPTY_SCREENING } from "../../automation/screening.js";
import { parseCVWithAI } from "../../ai/service.js";
import { asyncHandler } from "../middleware/error.js";
import type { UserProfile } from "../../types/index.js";

const UPLOAD_DIR = "./uploads";
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename:    (_req, file,  cb) => cb(null, `cv-${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [".pdf", ".txt", ".doc", ".docx"];
    const ext = path.extname(file.originalname).toLowerCase();
    allowed.includes(ext) ? cb(null, true) : cb(new Error(`File type ${ext} not allowed`));
  },
});

const router = Router();

// GET /api/user
router.get("/", asyncHandler(async (_req, res) => {
  const user = await db.getUser();
  if (!user) { res.status(404).json({ success: false, error: "User not found" }); return; }
  const safeUser = {
    ...user,
    profile: {
      ...user.profile,
      credentials: {
        linkedinEmail:    user.profile.credentials.linkedinEmail    ? "***" : undefined,
        linkedinPassword: user.profile.credentials.linkedinPassword ? "***" : undefined,
        indeedEmail:      user.profile.credentials.indeedEmail      ? "***" : undefined,
        indeedPassword:   user.profile.credentials.indeedPassword   ? "***" : undefined,
      },
    },
  };
  res.json({ success: true, data: safeUser });
}));

// PATCH /api/user
router.patch("/", asyncHandler(async (req, res) => {
  const body = req.body as Partial<UserProfile & { email: string }>;
  const user = await db.getUser();
  if (!user) { res.status(404).json({ success: false, error: "User not found" }); return; }
  const updatedProfile: UserProfile = {
    ...user.profile, ...body,
    credentials: { ...user.profile.credentials, ...(body.credentials ?? {}) },
    links:       { ...user.profile.links,       ...(body.links       ?? {}) },
    // Merged like the others so a partial update (e.g. just the answer bank)
    // does not wipe the rest of the screening answers.
    screening:   { ...EMPTY_SCREENING, ...user.profile.screening, ...(body.screening ?? {}) },
  };
  const updated = await db.updateUser({ email: body.email ?? user.email, profile: updatedProfile });
  res.json({ success: true, data: updated });
}));

// POST /api/user/cv — upload file
router.post("/cv", upload.single("cv"), asyncHandler(async (req, res) => {
  if (!req.file) { res.status(400).json({ success: false, error: "No file uploaded" }); return; }
  const user = await db.getUser();
  if (!user) { res.status(404).json({ success: false, error: "User not found" }); return; }

  if (user.cvFilename) {
    const old = path.join(UPLOAD_DIR, user.cvFilename);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }

  let cvText = "";
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext === ".pdf") {
    try {
      const pdfParse = (await import("pdf-parse")).default;
      const buffer = fs.readFileSync(req.file.path);
      const data = await pdfParse(buffer);
      cvText = data.text;
    } catch { cvText = ""; }
  } else if (ext === ".txt") {
    cvText = fs.readFileSync(req.file.path, "utf-8");
  }

  let parsedProfile: Partial<UserProfile> = {};
  if (cvText) {
    try { parsedProfile = await parseCVWithAI({ text: cvText }); } catch { /* ok */ }
  }

  const updatedProfile: UserProfile = {
    ...user.profile,
    ...(parsedProfile.fullName            ? { fullName:        parsedProfile.fullName }        : {}),
    ...(parsedProfile.email               ? { email:           parsedProfile.email }           : {}),
    ...(parsedProfile.phone               ? { phone:           parsedProfile.phone }           : {}),
    ...(parsedProfile.baseResume          ? { baseResume:      parsedProfile.baseResume }      : {}),
    ...(parsedProfile.targetTitles?.length? { targetTitles:    parsedProfile.targetTitles }    : {}),
    ...(parsedProfile.experienceLevel     ? { experienceLevel: parsedProfile.experienceLevel } : {}),
  };

  await db.updateUser({ cvFilename: req.file.filename, cvText, profile: updatedProfile });
  res.json({
    success: true,
    data: { filename: req.file.filename, textLength: cvText.length, parsedProfile, message: "CV uploaded and parsed" },
  });
}));

// POST /api/user/cv/text — paste plain text
router.post("/cv/text", asyncHandler(async (req, res) => {
  const { text } = req.body as { text: string };
  if (!text || typeof text !== "string" || text.trim().length < 50) {
    res.status(400).json({ success: false, error: "CV text too short (min 50 chars)" }); return;
  }
  const user = await db.getUser();
  if (!user) { res.status(404).json({ success: false, error: "User not found" }); return; }

  let parsedProfile: Partial<UserProfile> = {};
  try { parsedProfile = await parseCVWithAI({ text }); } catch { /* ok */ }

  const updatedProfile: UserProfile = {
    ...user.profile,
    ...(parsedProfile.fullName            ? { fullName:        parsedProfile.fullName }        : {}),
    ...(parsedProfile.baseResume          ? { baseResume:      parsedProfile.baseResume }      : {}),
    ...(parsedProfile.targetTitles?.length? { targetTitles:    parsedProfile.targetTitles }    : {}),
    ...(parsedProfile.experienceLevel     ? { experienceLevel: parsedProfile.experienceLevel } : {}),
  };
  await db.updateUser({ cvText: text, profile: updatedProfile });
  res.json({ success: true, data: { textLength: text.length, parsedProfile } });
}));

export { router as userRouter };
