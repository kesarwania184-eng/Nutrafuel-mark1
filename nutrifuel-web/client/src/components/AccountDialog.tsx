import { useRef, useState } from "react";
import { Download, Leaf, LockKeyhole, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { normalizeSnapshot, type NutritionSnapshot } from "@shared/nutrition";
import { z } from "zod";

type AccountUser = {
  openId: string;
  name?: string | null;
  email?: string | null;
  hasPassword?: boolean;
};
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: AccountUser | null;
  snapshot: NutritionSnapshot;
  onRestore: (snapshot: NutritionSnapshot) => void;
  onLogout: () => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const backupSnapshotSchema = z.object({
  version: z.literal(1),
  entries: z
    .array(
      z.object({
        id: z.string().min(1).max(120),
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine(value => {
            const parsed = new Date(`${value}T00:00:00.000Z`);
            return (
              Number.isFinite(parsed.getTime()) &&
              parsed.toISOString().slice(0, 10) === value
            );
          }),
        meal: z.enum(["breakfast", "lunch", "dinner", "snack"]),
        food: z.string().trim().min(1).max(160),
        calories: z.number().finite().min(0).max(10000),
        protein: z.number().finite().min(0).max(1000),
        carbs: z.number().finite().min(0).max(1000),
        fat: z.number().finite().min(0).max(1000),
        updatedAt: z.string().datetime({ offset: true }),
        deletedAt: z.string().datetime({ offset: true }).nullable().optional(),
      })
    )
    .max(1000),
  goals: z.object({
    calories: z.number().finite().min(0).max(10000),
    protein: z.number().finite().min(0).max(1000),
    carbs: z.number().finite().min(0).max(1000),
    fat: z.number().finite().min(0).max(1000),
  }),
  goalsUpdatedAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

function parseBackup(value: unknown): NutritionSnapshot {
  const root = isRecord(value) ? value : null;
  const raw =
    root && root.format === "nutrifuel-backup-v1" ? root.snapshot : value;
  const parsed = backupSnapshotSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      "This backup is incomplete or invalid. Your current meal history was left unchanged."
    );
  }
  return normalizeSnapshot(parsed.data);
}

export function AccountDialog({
  open,
  onOpenChange,
  user,
  snapshot,
  onRestore,
  onLogout,
}: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const login = trpc.auth.login.useMutation();
  const register = trpc.auth.register.useMutation();
  const changePassword = trpc.auth.changePassword.useMutation();
  const pending =
    login.isPending || register.isPending || changePassword.isPending;

  async function submitCredentials(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      if (mode === "register") {
        await register.mutateAsync({ email, password, name });
      } else {
        await login.mutateAsync({ email, password });
      }
      await utils.auth.me.invalidate();
      setPassword("");
      onOpenChange(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not sign in. Please try again."
      );
    }
  }

  async function submitPasswordChange(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      await changePassword.mutateAsync({ currentPassword, newPassword });
      await utils.auth.me.invalidate();
      setCurrentPassword("");
      setNewPassword("");
      setMessage(
        "Password changed. Other active sessions have been signed out."
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not change the password."
      );
    }
  }

  function downloadBackup() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            format: "nutrifuel-backup-v1",
            exportedAt: new Date().toISOString(),
            snapshot,
          },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `nutrifuel-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    setMessage("Backup downloaded. Keep it somewhere safe.");
  }

  async function restoreBackup(file?: File) {
    if (!file) return;
    setError("");
    setMessage("");
    try {
      if (file.size > 5 * 1024 * 1024)
        throw new Error("Backup files must be smaller than 5 MB.");
      const imported = parseBackup(JSON.parse(await file.text()));
      onRestore(imported);
      setMessage("Backup restored and merged with your current meal history.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not read this backup file."
      );
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl border-[#e3e9df] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#244c3d]">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#e9f2dc]">
              <Leaf size={18} />
            </span>
            {user
              ? "Your NutriFuel account"
              : mode === "register"
                ? "Create your account"
                : "Welcome back"}
          </DialogTitle>
          <DialogDescription>
            {user
              ? "Your meals and daily targets sync privately to your account."
              : "Create an account to keep your meal history safe and sync it across devices."}
          </DialogDescription>
        </DialogHeader>

        {user ? (
          <div className="space-y-5">
            <div className="rounded-2xl bg-[#f5f8f1] p-4">
              <p className="text-sm font-bold text-[#244c3d]">
                {user.name || "NutriFuel member"}
              </p>
              <p className="mt-1 text-xs text-[#718277]">
                {user.email || "Signed in with your connected provider"}
              </p>
              <p className="mt-3 flex items-center gap-2 text-xs text-[#607466]">
                <LockKeyhole size={14} /> Private meal history · 30-day secure
                sessions
              </p>
            </div>

            {user.hasPassword && (
              <form
                onSubmit={submitPasswordChange}
                className="space-y-3 rounded-2xl border border-[#e8ede4] p-4"
              >
                <h3 className="text-sm font-bold">Change password</h3>
                <label className="block space-y-1 text-xs font-semibold text-[#607466]">
                  Current password
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={event => setCurrentPassword(event.target.value)}
                    required
                    maxLength={128}
                  />
                </label>
                <label className="block space-y-1 text-xs font-semibold text-[#607466]">
                  New password (12+ characters)
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={event => setNewPassword(event.target.value)}
                    required
                    minLength={12}
                    maxLength={128}
                  />
                </label>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={pending || newPassword.length < 12}
                  className="w-full rounded-xl"
                >
                  Update password
                </Button>
              </form>
            )}

            <Button
              type="button"
              variant="ghost"
              onClick={async () => {
                try {
                  await onLogout();
                  onOpenChange(false);
                } catch (cause) {
                  setError(
                    cause instanceof Error
                      ? cause.message
                      : "Could not sign out."
                  );
                }
              }}
              className="w-full rounded-xl text-rose-700 hover:bg-rose-50"
            >
              Sign out
            </Button>
          </div>
        ) : (
          <form onSubmit={submitCredentials} className="space-y-3">
            {mode === "register" && (
              <label className="block space-y-1 text-xs font-semibold text-[#607466]">
                Your name
                <Input
                  autoComplete="name"
                  value={name}
                  onChange={event => setName(event.target.value)}
                  required
                  minLength={1}
                  maxLength={80}
                  placeholder="How should we greet you?"
                />
              </label>
            )}
            <label className="block space-y-1 text-xs font-semibold text-[#607466]">
              Email
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                required
                maxLength={320}
                placeholder="you@example.com"
              />
            </label>
            <label className="block space-y-1 text-xs font-semibold text-[#607466]">
              Password
              <Input
                type="password"
                autoComplete={
                  mode === "register" ? "new-password" : "current-password"
                }
                value={password}
                onChange={event => setPassword(event.target.value)}
                required
                minLength={mode === "register" ? 12 : 1}
                maxLength={128}
                placeholder={
                  mode === "register"
                    ? "At least 12 characters"
                    : "Your password"
                }
              />
            </label>
            {mode === "register" && (
              <p className="text-[11px] leading-5 text-[#829087]">
                Use 12 or more characters. Your password is stored as a salted,
                one-way hash.
              </p>
            )}
            <Button
              type="submit"
              disabled={
                pending || (mode === "register" && password.length < 12)
              }
              className="w-full rounded-xl bg-[#315941] hover:bg-[#234b37]"
            >
              {pending
                ? "Please wait…"
                : mode === "register"
                  ? "Create account & save my meals"
                  : "Sign in"}
            </Button>
            {mode === "login" && (
              <p className="text-center text-[11px] leading-5 text-[#89968c]">
                Forgot your password? Email reset is not set up yet. The app
                owner will need to configure an email service before password
                recovery is available.
              </p>
            )}
            <p className="text-center text-xs text-[#718277]">
              {mode === "register"
                ? "Already have an account?"
                : "New to NutriFuel?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setMode(mode === "register" ? "login" : "register");
                  setError("");
                }}
                className="font-bold text-[#315941] underline underline-offset-2"
              >
                {mode === "register" ? "Sign in" : "Create one"}
              </button>
            </p>
            <p className="text-center text-[11px] leading-5 text-[#89968c]">
              Signing in requires the app owner to configure its database. Your
              device log remains available if account sync is not configured.
            </p>
          </form>
        )}
        <div className="space-y-2 rounded-2xl border border-[#e8ede4] p-4">
          <h3 className="text-sm font-bold">
            Keep a copy of your meal history
          </h3>
          <p className="text-xs leading-5 text-[#718277]">
            Download a backup any time. Restore merges its entries with your
            current log; it never replaces it.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={downloadBackup}
            className="w-full rounded-xl"
          >
            <Download size={15} /> Download backup
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="Choose a NutriFuel backup file"
            onChange={event => void restoreBackup(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInput.current?.click()}
            className="w-full rounded-xl"
          >
            <Upload size={15} /> Restore backup
          </Button>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-800"
          >
            {error}
          </p>
        )}
        {message && (
          <p
            role="status"
            className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800"
          >
            {message}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
