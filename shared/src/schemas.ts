import { z } from 'zod';
import {
  ALIAS_MAX,
  GROUP_NAME_MAX,
  GROUP_NAME_MIN,
  MESSAGE_MAX,
  NOTES_MAX,
  PASSWORD_MIN,
  PLACE_SIZE,
  THEMES,
  USERNAME_RE,
} from './constants';

export const usernameSchema = z
  .string()
  .trim()
  .regex(USERNAME_RE, 'Benutzername: 3–30 Zeichen, nur Buchstaben, Zahlen, . _ -');

export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Passwort muss mindestens ${PASSWORD_MIN} Zeichen haben`)
  .max(200);

export const colorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Ungültige Farbe')
  .nullable();

export const emojiSchema = z.string().trim().max(16).nullable();

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  remember: z.boolean().optional().default(true),
  website: z.string().max(0).optional(), // honeypot
});

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(30),
  password: z.string().min(1).max(200),
  remember: z.boolean().optional().default(true),
});

export const updateProfileSchema = z
  .object({
    username: usernameSchema.optional(),
    color: colorSchema.optional(),
    emoji: emojiSchema.optional(),
    theme: z.enum(THEMES).optional(),
  })
  .strict();

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1).max(200),
});

export const updateContactSchema = z
  .object({
    alias: z.string().trim().max(ALIAS_MAX).nullable().optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export const sendMessageSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    body: z.string().trim().min(1, 'Nachricht ist leer').max(MESSAGE_MAX),
    clientId: z.string().max(64).optional(),
  }),
  z.object({
    kind: z.literal('gif'),
    gifUrl: z
      .string()
      .url()
      .max(1000)
      .refine((u) => /^https:\/\/(media[0-9]*\.giphy\.com|i\.giphy\.com|media\.tenor\.com)\//.test(u), 'Nur Giphy/Tenor-GIFs'),
    clientId: z.string().max(64).optional(),
  }),
]);

export const editMessageSchema = z.object({
  body: z.string().trim().min(1).max(MESSAGE_MAX),
});

export const markReadSchema = z.object({
  lastReadMessageId: z.number().int().positive(),
});

export const messagesQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  after: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const createGroupSchema = z.object({
  name: z.string().trim().min(GROUP_NAME_MIN).max(GROUP_NAME_MAX),
  memberIds: z.array(z.number().int().positive()).max(200).default([]),
});

export const renameGroupSchema = z.object({
  name: z.string().trim().min(GROUP_NAME_MIN).max(GROUP_NAME_MAX),
});

export const addMemberSchema = z.object({
  userId: z.number().int().positive(),
});

export const notesSchema = z.object({
  content: z.string().max(NOTES_MAX),
});

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url().max(2000),
});

export const pushReplySchema = z.object({
  conversationId: z.number().int().positive(),
  text: z.string().trim().min(1).max(MESSAGE_MAX),
});

export const bugReportSchema = z.object({
  type: z.enum(['bug', 'feature', 'question']),
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(3).max(5000),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
});

export const bugStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'closed']),
});

export const bugReplySchema = z.object({
  text: z.string().trim().min(2).max(MESSAGE_MAX),
});

export const adminResetPasswordSchema = z.object({
  newPassword: passwordSchema,
});

export const adminRoleSchema = z.object({
  role: z.number().int().min(0).max(3),
});

export const visitSchema = z.object({
  page: z.string().trim().min(1).max(64),
});

export const placePixelSchema = z.object({
  x: z.number().int().min(0).max(PLACE_SIZE - 1),
  y: z.number().int().min(0).max(PLACE_SIZE - 1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
