import { randomBytes } from "node:crypto";
import { and, count, desc, eq, inArray, sql, sum } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import type { File } from "@google-cloud/storage";
import { Router, type IRouter, type NextFunction, type Request, type Response } from "express";
import {
  ClaimInitialAdminBody,
  ClaimInitialAdminResponse,
  CreateFileBody,
  CreateFileResponse,
  CreateLinkBody,
  CreateLinkResponse,
  CreateSubmissionBody,
  CreateSubmissionParams,
  CreateSubmissionResponse,
  DeleteFileParams,
  DeleteLinkParams,
  DeleteSubmissionParams,
  DownloadSharedFileParams,
  GetAdminBootstrapStateResponse,
  GetDashboardSummaryResponse,
  GetPublicShareParams,
  GetPublicShareResponse,
  GetSharedFileContentParams,
  GetSubmissionContentParams,
  ListActivityResponse,
  ListFilesResponse,
  ListLinksResponse,
  ListSubmissionsResponse,
  RequestSubmissionUploadUrlBody,
  RequestSubmissionUploadUrlParams,
  RequestSubmissionUploadUrlResponse,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
  UpdateLinkBody,
  UpdateLinkParams,
  UpdateLinkResponse,
} from "@workspace/api-zod";
import {
  db,
  secureShareActivityTable,
  secureShareAdminsTable,
  secureShareFilesTable,
  secureShareLinkFilesTable,
  secureShareLinksTable,
  secureShareSubmissionsTable,
} from "@workspace/db";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();
const MAX_FILE_BYTES = 500 * 1024 * 1024;
const MAX_SUBMISSION_BYTES = 50 * 1024 * 1024;
const MAX_LINK_SUBMISSIONS = 20;

const allowedFileTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);
const allowedSubmissionTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);
const objectPathPattern = /^\/objects\/uploads\/[0-9a-f-]{36}$/i;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function param(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function sessionEmail(req: Request): string | null {
  const claims = getAuth(req).sessionClaims as
    | Record<string, unknown>
    | undefined;
  return typeof claims?.email === "string" ? claims.email : null;
}

async function isAdmin(userId: string): Promise<boolean> {
  const [admin] = await db
    .select({ userId: secureShareAdminsTable.userId })
    .from(secureShareAdminsTable)
    .where(eq(secureShareAdminsTable.userId, userId))
    .limit(1);
  return Boolean(admin);
}

async function requireSignedIn(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  next();
}

async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in required" });
    return;
  }
  if (!(await isAdmin(userId))) {
    res.status(403).json({ error: "Administrator access required" });
    return;
  }
  next();
}

function linkIsAvailable(link: typeof secureShareLinksTable.$inferSelect): boolean {
  return link.active && (!link.expiresAt || link.expiresAt.getTime() > Date.now());
}

function validObjectPath(path: string): boolean {
  return objectPathPattern.test(path);
}

function safeFilename(name: string): string {
  return name.replace(/[\r\n"\\/]/g, "_").slice(0, 255) || "shared-file";
}

async function getLinkWithFiles(linkId: string) {
  const [link] = await db
    .select()
    .from(secureShareLinksTable)
    .where(eq(secureShareLinksTable.id, linkId))
    .limit(1);
  if (!link) return null;

  const files = await db
    .select({
      id: secureShareFilesTable.id,
      name: secureShareFilesTable.name,
      contentType: secureShareFilesTable.contentType,
      size: secureShareFilesTable.size,
    })
    .from(secureShareLinkFilesTable)
    .innerJoin(
      secureShareFilesTable,
      eq(secureShareLinkFilesTable.fileId, secureShareFilesTable.id),
    )
    .where(eq(secureShareLinkFilesTable.linkId, link.id));

  return { ...link, files };
}

async function getShareAndFile(token: string, fileId: string) {
  if (!uuidPattern.test(fileId)) return null;
  const [row] = await db
    .select({
      link: secureShareLinksTable,
      file: secureShareFilesTable,
    })
    .from(secureShareLinksTable)
    .innerJoin(
      secureShareLinkFilesTable,
      eq(secureShareLinkFilesTable.linkId, secureShareLinksTable.id),
    )
    .innerJoin(
      secureShareFilesTable,
      eq(secureShareFilesTable.id, secureShareLinkFilesTable.fileId),
    )
    .where(
      and(
        eq(secureShareLinksTable.token, token),
        eq(secureShareLinksTable.active, true),
        eq(secureShareFilesTable.id, fileId),
      ),
    )
    .limit(1);
  if (!row || !linkIsAvailable(row.link)) return null;
  return row;
}

async function recordFileAccess(
  link: typeof secureShareLinksTable.$inferSelect,
  file: typeof secureShareFilesTable.$inferSelect,
): Promise<void> {
  const accessedAt = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(secureShareActivityTable).values({
      linkId: link.id,
      fileId: file.id,
      linkTitle: link.title,
      fileName: file.name,
      accessedAt,
    });
    await tx
      .update(secureShareLinksTable)
      .set({
        accessCount: sql`${secureShareLinksTable.accessCount} + 1`,
        lastAccessAt: accessedAt,
      })
      .where(eq(secureShareLinksTable.id, link.id));
  });
}

async function streamPrivateFile(
  req: Request,
  res: Response,
  file: File,
  name: string,
  contentType: string,
  attachment: boolean,
): Promise<void> {
  const [metadata] = await file.getMetadata();
  const size = Number(metadata.size ?? 0);
  const disposition = attachment ? "attachment" : "inline";
  const encodedName = encodeURIComponent(safeFilename(name));
  res.setHeader("Content-Type", contentType);
  res.setHeader(
    "Content-Disposition",
    `${disposition}; filename="shared-file"; filename*=UTF-8''${encodedName}`,
  );
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Accept-Ranges", "bytes");

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (!match || size <= 0) {
      res.setHeader("Content-Range", `bytes */${size}`);
      res.status(416).end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      res.setHeader("Content-Range", `bytes */${size}`);
      res.status(416).end();
      return;
    }
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    file.createReadStream({ start, end }).pipe(res);
    return;
  }

  if (size > 0) res.setHeader("Content-Length", String(size));
  file.createReadStream().pipe(res);
}

function handleStorageError(req: Request, res: Response, error: unknown): void {
  if (error instanceof ObjectNotFoundError) {
    res.status(404).json({ error: "File not found" });
    return;
  }
  req.log.error({ err: error }, "SecureShare storage request failed");
  res.status(500).json({ error: "Unable to access private storage" });
}

router.get(
  "/admin/bootstrap-state",
  requireSignedIn,
  async (req, res): Promise<void> => {
    const userId = getAuth(req).userId!;
    const [admin] = await db.select().from(secureShareAdminsTable).limit(1);
    const ownAdmin = admin?.userId === userId;
    res.json(
      GetAdminBootstrapStateResponse.parse({
        isAdmin: ownAdmin,
        bootstrapAvailable: !admin,
        email: sessionEmail(req),
        displayName: ownAdmin ? admin.displayName : null,
      }),
    );
  },
);

router.post(
  "/admin/bootstrap",
  requireSignedIn,
  async (req, res): Promise<void> => {
    const parsed = ClaimInitialAdminBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const userId = getAuth(req).userId!;
    const [existing] = await db
      .select()
      .from(secureShareAdminsTable)
      .where(eq(secureShareAdminsTable.userId, userId))
      .limit(1);
    if (existing) {
      res.json(
        ClaimInitialAdminResponse.parse({
          isAdmin: true,
          bootstrapAvailable: false,
          email: sessionEmail(req),
          displayName: existing.displayName,
        }),
      );
      return;
    }

    const [claimed] = await db
      .insert(secureShareAdminsTable)
      .values({ id: 1, userId, displayName: parsed.data.displayName.trim() })
      .onConflictDoNothing()
      .returning();
    if (!claimed) {
      res.status(409).json({ error: "Initial administrator is already set up" });
      return;
    }

    res.status(201).json(
      ClaimInitialAdminResponse.parse({
        isAdmin: true,
        bootstrapAvailable: false,
        email: sessionEmail(req),
        displayName: claimed.displayName,
      }),
    );
  },
);

router.get("/dashboard/summary", requireAdmin, async (_req, res): Promise<void> => {
  const [files] = await db
    .select({ value: count(), bytes: sum(secureShareFilesTable.size) })
    .from(secureShareFilesTable);
  const links = await db.select().from(secureShareLinksTable);
  const activeLinks = links.filter(linkIsAvailable).length;
  const [submissions] = await db
    .select({ value: count() })
    .from(secureShareSubmissionsTable);
  const [accesses] = await db
    .select({ value: count() })
    .from(secureShareActivityTable);
  const recentActivity = await db
    .select({
      id: secureShareActivityTable.id,
      linkTitle: secureShareActivityTable.linkTitle,
      fileName: secureShareActivityTable.fileName,
      accessedAt: secureShareActivityTable.accessedAt,
    })
    .from(secureShareActivityTable)
    .orderBy(desc(secureShareActivityTable.accessedAt))
    .limit(6);
  res.json(
    GetDashboardSummaryResponse.parse({
      fileCount: files.value,
      activeLinkCount: activeLinks,
      accessCount: accesses.value,
      submissionCount: submissions.value,
      storageBytes: Number(files.bytes ?? 0),
      recentActivity,
    }),
  );
});

router.get("/files", requireAdmin, async (_req, res): Promise<void> => {
  const files = await db
    .select()
    .from(secureShareFilesTable)
    .orderBy(desc(secureShareFilesTable.createdAt));
  const linkRefs = await db.select().from(secureShareLinkFilesTable);
  const shareCounts = new Map<string, number>();
  for (const ref of linkRefs) {
    shareCounts.set(ref.fileId, (shareCounts.get(ref.fileId) ?? 0) + 1);
  }
  res.json(
    ListFilesResponse.parse(
      files.map((file) => ({
        id: file.id,
        name: file.name,
        contentType: file.contentType,
        size: file.size,
        createdAt: file.createdAt,
        shareCount: shareCounts.get(file.id) ?? 0,
      })),
    ),
  );
});

router.post(
  "/storage/uploads/request-url",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (
      parsed.data.size > MAX_FILE_BYTES ||
      !allowedFileTypes.has(parsed.data.contentType)
    ) {
      res.status(400).json({ error: "Unsupported file type or size" });
      return;
    }
    try {
      const uploadURL = await storage.getObjectEntityUploadURL();
      const objectPath = storage.normalizeObjectEntityPath(uploadURL);
      if (!validObjectPath(objectPath)) {
        throw new Error("Storage returned an invalid private object path");
      }
      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: parsed.data,
        }),
      );
    } catch (error) {
      handleStorageError(req, res, error);
    }
  },
);

router.post("/files", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateFileBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const input = parsed.data;
  if (
    input.size > MAX_FILE_BYTES ||
    !allowedFileTypes.has(input.contentType) ||
    !validObjectPath(input.objectPath)
  ) {
    res.status(400).json({ error: "Unsupported file metadata or storage path" });
    return;
  }

  try {
    const uploadedObject = await storage.getObjectEntityFile(input.objectPath);
    const [metadata] = await uploadedObject.getMetadata();
    if (Number(metadata.size ?? 0) !== input.size) {
      res.status(400).json({ error: "Uploaded file size does not match" });
      return;
    }
    if (
      typeof metadata.contentType === "string" &&
      metadata.contentType !== input.contentType
    ) {
      res.status(400).json({ error: "Uploaded file type does not match" });
      return;
    }
    const [file] = await db
      .insert(secureShareFilesTable)
      .values({
        name: safeFilename(input.name),
        contentType: input.contentType,
        size: input.size,
        objectPath: input.objectPath,
      })
      .returning();
    res.status(201).json(
      CreateFileResponse.parse({ ...file, shareCount: 0 }),
    );
  } catch (error) {
    handleStorageError(req, res, error);
  }
});

router.delete(
  "/files/:fileId",
  requireAdmin,
  async (req, res): Promise<void> => {
    const parsed = DeleteFileParams.safeParse(req.params);
    if (!parsed.success || !uuidPattern.test(parsed.data.fileId)) {
      res.status(400).json({ error: "Invalid file id" });
      return;
    }
    const [file] = await db
      .select()
      .from(secureShareFilesTable)
      .where(eq(secureShareFilesTable.id, parsed.data.fileId))
      .limit(1);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    try {
      const affectedLinks = await db
        .select({ linkId: secureShareLinkFilesTable.linkId })
        .from(secureShareLinkFilesTable)
        .where(eq(secureShareLinkFilesTable.fileId, file.id));
      await storage.deleteObjectEntity(file.objectPath);
      await db
        .delete(secureShareFilesTable)
        .where(eq(secureShareFilesTable.id, file.id));
      for (const { linkId } of affectedLinks) {
        const [remaining] = await db
          .select({ value: count() })
          .from(secureShareLinkFilesTable)
          .where(eq(secureShareLinkFilesTable.linkId, linkId));
        if (remaining.value === 0) {
          await db
            .update(secureShareLinksTable)
            .set({ active: false })
            .where(eq(secureShareLinksTable.id, linkId));
        }
      }
      res.sendStatus(204);
    } catch (error) {
      handleStorageError(req, res, error);
    }
  },
);

router.get("/links", requireAdmin, async (_req, res): Promise<void> => {
  const links = await db
    .select()
    .from(secureShareLinksTable)
    .orderBy(desc(secureShareLinksTable.createdAt));
  const result = [];
  for (const link of links) {
    result.push(await getLinkWithFiles(link.id));
  }
  res.json(ListLinksResponse.parse(result.filter(Boolean)));
});

router.post("/links", requireAdmin, async (req, res): Promise<void> => {
  const parsed = CreateLinkBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const fileIds = [...new Set(parsed.data.fileIds)];
  if (fileIds.length !== parsed.data.fileIds.length) {
    res.status(400).json({ error: "Choose each file only once" });
    return;
  }
  const files = await db
    .select({ id: secureShareFilesTable.id })
    .from(secureShareFilesTable)
    .where(inArray(secureShareFilesTable.id, fileIds));
  if (files.length !== fileIds.length) {
    res.status(400).json({ error: "One or more selected files do not exist" });
    return;
  }
  if (
    parsed.data.expiresAt &&
    parsed.data.expiresAt.getTime() <= Date.now()
  ) {
    res.status(400).json({ error: "Expiration must be in the future" });
    return;
  }

  const [link] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(secureShareLinksTable)
      .values({
        title: parsed.data.title.trim(),
        token: randomBytes(32).toString("base64url"),
        allowSubmissions: parsed.data.allowSubmissions,
        expiresAt: parsed.data.expiresAt ?? null,
      })
      .returning();
    await tx.insert(secureShareLinkFilesTable).values(
      fileIds.map((fileId) => ({ linkId: created.id, fileId })),
    );
    return [created];
  });
  const detail = await getLinkWithFiles(link.id);
  res.status(201).json(CreateLinkResponse.parse(detail));
});

router.patch("/links/:linkId", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateLinkParams.safeParse(req.params);
  const parsed = UpdateLinkBody.safeParse(req.body);
  if (!params.success || !uuidPattern.test(params.data.linkId) || !parsed.success) {
    res.status(400).json({ error: "Invalid link update" });
    return;
  }
  if (
    parsed.data.expiresAt &&
    parsed.data.expiresAt.getTime() <= Date.now()
  ) {
    res.status(400).json({ error: "Expiration must be in the future" });
    return;
  }
  const updates: {
    title?: string;
    active?: boolean;
    allowSubmissions?: boolean;
    expiresAt?: Date | null;
  } = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title.trim();
  if (parsed.data.active !== undefined) updates.active = parsed.data.active;
  if (parsed.data.allowSubmissions !== undefined) {
    updates.allowSubmissions = parsed.data.allowSubmissions;
  }
  if (parsed.data.expiresAt !== undefined) {
    updates.expiresAt = parsed.data.expiresAt ?? null;
  }
  const [updated] = await db
    .update(secureShareLinksTable)
    .set(updates)
    .where(eq(secureShareLinksTable.id, params.data.linkId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Share link not found" });
    return;
  }
  res.json(UpdateLinkResponse.parse(await getLinkWithFiles(updated.id)));
});

router.delete(
  "/links/:linkId",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = DeleteLinkParams.safeParse(req.params);
    if (!params.success || !uuidPattern.test(params.data.linkId)) {
      res.status(400).json({ error: "Invalid link id" });
      return;
    }
    const submissions = await db
      .select({ objectPath: secureShareSubmissionsTable.objectPath })
      .from(secureShareSubmissionsTable)
      .where(eq(secureShareSubmissionsTable.linkId, params.data.linkId));
    try {
      for (const submission of submissions) {
        await storage.deleteObjectEntity(submission.objectPath);
      }
      const [deleted] = await db
        .delete(secureShareLinksTable)
        .where(eq(secureShareLinksTable.id, params.data.linkId))
        .returning({ id: secureShareLinksTable.id });
      if (!deleted) {
        res.status(404).json({ error: "Share link not found" });
        return;
      }
      res.sendStatus(204);
    } catch (error) {
      handleStorageError(req, res, error);
    }
  },
);

router.get("/activity", requireAdmin, async (_req, res): Promise<void> => {
  const activity = await db
    .select({
      id: secureShareActivityTable.id,
      linkTitle: secureShareActivityTable.linkTitle,
      fileName: secureShareActivityTable.fileName,
      accessedAt: secureShareActivityTable.accessedAt,
    })
    .from(secureShareActivityTable)
    .orderBy(desc(secureShareActivityTable.accessedAt))
    .limit(100);
  res.json(ListActivityResponse.parse(activity));
});

router.get("/shares/:token", async (req, res): Promise<void> => {
  const parsed = GetPublicShareParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(404).json({ error: "This sharing link is invalid or expired" });
    return;
  }
  const [link] = await db
    .select()
    .from(secureShareLinksTable)
    .where(eq(secureShareLinksTable.token, parsed.data.token))
    .limit(1);
  if (!link || !linkIsAvailable(link)) {
    res.status(404).json({ error: "This sharing link is invalid or expired" });
    return;
  }
  const files = await db
    .select({
      id: secureShareFilesTable.id,
      name: secureShareFilesTable.name,
      contentType: secureShareFilesTable.contentType,
      size: secureShareFilesTable.size,
    })
    .from(secureShareLinkFilesTable)
    .innerJoin(
      secureShareFilesTable,
      eq(secureShareLinkFilesTable.fileId, secureShareFilesTable.id),
    )
    .where(eq(secureShareLinkFilesTable.linkId, link.id));
  res.json(
    GetPublicShareResponse.parse({
      title: link.title,
      expiresAt: link.expiresAt,
      allowSubmissions: link.allowSubmissions,
      files,
    }),
  );
});

router.get(
  "/shares/:token/files/:fileId/content",
  async (req, res): Promise<void> => {
    const params = GetSharedFileContentParams.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const row = await getShareAndFile(params.data.token, params.data.fileId);
    if (!row) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    try {
      const object = await storage.getObjectEntityFile(row.file.objectPath);
      await recordFileAccess(row.link, row.file);
      await streamPrivateFile(
        req,
        res,
        object,
        row.file.name,
        row.file.contentType,
        false,
      );
    } catch (error) {
      handleStorageError(req, res, error);
    }
  },
);

router.get(
  "/shares/:token/files/:fileId/download",
  async (req, res): Promise<void> => {
    const params = DownloadSharedFileParams.safeParse(req.params);
    if (!params.success) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    const row = await getShareAndFile(params.data.token, params.data.fileId);
    if (!row) {
      res.status(404).json({ error: "File not found" });
      return;
    }
    try {
      const object = await storage.getObjectEntityFile(row.file.objectPath);
      await recordFileAccess(row.link, row.file);
      await streamPrivateFile(
        req,
        res,
        object,
        row.file.name,
        row.file.contentType,
        true,
      );
    } catch (error) {
      handleStorageError(req, res, error);
    }
  },
);

router.post(
  "/shares/:token/submissions/upload-url",
  async (req, res): Promise<void> => {
    const params = RequestSubmissionUploadUrlParams.safeParse(req.params);
    const parsed = RequestSubmissionUploadUrlBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Invalid submission upload request" });
      return;
    }
    const [link] = await db
      .select()
      .from(secureShareLinksTable)
      .where(eq(secureShareLinksTable.token, params.data.token))
      .limit(1);
    if (!link || !linkIsAvailable(link)) {
      res.status(404).json({ error: "This sharing link is invalid or expired" });
      return;
    }
    if (!link.allowSubmissions) {
      res.status(403).json({ error: "Media submissions are not enabled" });
      return;
    }
    if (
      parsed.data.size > MAX_SUBMISSION_BYTES ||
      !allowedSubmissionTypes.has(parsed.data.contentType)
    ) {
      res.status(400).json({ error: "Unsupported media type or size" });
      return;
    }
    const [existingCount] = await db
      .select({ value: count() })
      .from(secureShareSubmissionsTable)
      .where(eq(secureShareSubmissionsTable.linkId, link.id));
    if (existingCount.value >= MAX_LINK_SUBMISSIONS) {
      res.status(429).json({ error: "This link has reached its submission limit" });
      return;
    }
    try {
      const uploadURL = await storage.getObjectEntityUploadURL();
      const objectPath = storage.normalizeObjectEntityPath(uploadURL);
      if (!validObjectPath(objectPath)) {
        throw new Error("Storage returned an invalid private object path");
      }
      res.json(
        RequestSubmissionUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: parsed.data,
        }),
      );
    } catch (error) {
      handleStorageError(req, res, error);
    }
  },
);

router.post(
  "/shares/:token/submissions",
  async (req, res): Promise<void> => {
    const params = CreateSubmissionParams.safeParse(req.params);
    const parsed = CreateSubmissionBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Invalid submission" });
      return;
    }
    const [link] = await db
      .select()
      .from(secureShareLinksTable)
      .where(eq(secureShareLinksTable.token, params.data.token))
      .limit(1);
    if (!link || !linkIsAvailable(link)) {
      res.status(404).json({ error: "This sharing link is invalid or expired" });
      return;
    }
    if (!link.allowSubmissions) {
      res.status(403).json({ error: "Media submissions are not enabled" });
      return;
    }
    const input = parsed.data;
    if (
      input.size > MAX_SUBMISSION_BYTES ||
      !allowedSubmissionTypes.has(input.contentType) ||
      !validObjectPath(input.objectPath)
    ) {
      res.status(400).json({ error: "Unsupported media or storage path" });
      return;
    }
    const [existingCount] = await db
      .select({ value: count() })
      .from(secureShareSubmissionsTable)
      .where(eq(secureShareSubmissionsTable.linkId, link.id));
    if (existingCount.value >= MAX_LINK_SUBMISSIONS) {
      res.status(429).json({ error: "This link has reached its submission limit" });
      return;
    }
    try {
      const object = await storage.getObjectEntityFile(input.objectPath);
      const [metadata] = await object.getMetadata();
      if (Number(metadata.size ?? 0) !== input.size) {
        res.status(400).json({ error: "Uploaded media size does not match" });
        return;
      }
      const [submission] = await db
        .insert(secureShareSubmissionsTable)
        .values({
          linkId: link.id,
          name: safeFilename(input.name),
          contentType: input.contentType,
          size: input.size,
          objectPath: input.objectPath,
        })
        .returning();
      res.status(201).json(
        CreateSubmissionResponse.parse({
          id: submission.id,
          linkTitle: link.title,
          name: submission.name,
          contentType: submission.contentType,
          size: submission.size,
          createdAt: submission.createdAt,
        }),
      );
    } catch (error) {
      handleStorageError(req, res, error);
    }
  },
);

router.get(
  "/submissions",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({
        id: secureShareSubmissionsTable.id,
        linkTitle: secureShareLinksTable.title,
        name: secureShareSubmissionsTable.name,
        contentType: secureShareSubmissionsTable.contentType,
        size: secureShareSubmissionsTable.size,
        createdAt: secureShareSubmissionsTable.createdAt,
      })
      .from(secureShareSubmissionsTable)
      .innerJoin(
        secureShareLinksTable,
        eq(secureShareSubmissionsTable.linkId, secureShareLinksTable.id),
      )
      .orderBy(desc(secureShareSubmissionsTable.createdAt));
    res.json(ListSubmissionsResponse.parse(rows));
  },
);

router.get(
  "/submissions/:submissionId/content",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = GetSubmissionContentParams.safeParse(req.params);
    if (!params.success || !uuidPattern.test(params.data.submissionId)) {
      res.status(400).json({ error: "Invalid submission id" });
      return;
    }
    const [submission] = await db
      .select()
      .from(secureShareSubmissionsTable)
      .where(eq(secureShareSubmissionsTable.id, params.data.submissionId))
      .limit(1);
    if (!submission) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }
    try {
      const object = await storage.getObjectEntityFile(submission.objectPath);
      await streamPrivateFile(
        req,
        res,
        object,
        submission.name,
        submission.contentType,
        false,
      );
    } catch (error) {
      handleStorageError(req, res, error);
    }
  },
);

router.delete(
  "/submissions/:submissionId",
  requireAdmin,
  async (req, res): Promise<void> => {
    const params = DeleteSubmissionParams.safeParse(req.params);
    if (!params.success || !uuidPattern.test(params.data.submissionId)) {
      res.status(400).json({ error: "Invalid submission id" });
      return;
    }
    const [submission] = await db
      .select()
      .from(secureShareSubmissionsTable)
      .where(eq(secureShareSubmissionsTable.id, params.data.submissionId))
      .limit(1);
    if (!submission) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }
    try {
      await storage.deleteObjectEntity(submission.objectPath);
      await db
        .delete(secureShareSubmissionsTable)
        .where(eq(secureShareSubmissionsTable.id, submission.id));
      res.sendStatus(204);
    } catch (error) {
      handleStorageError(req, res, error);
    }
  },
);

export default router;
