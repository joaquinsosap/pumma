"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bell, BellOff, Trash2 } from "@/components/icons";
import { Switch } from "@/components/ui/switch";
import { LEAD_CHOICES } from "@/lib/notifications";
import {
  listPushDevicesAction,
  refreshNotificationsAction,
  removePushDeviceAction,
} from "@/lib/actions/notifications";
import { updateSettingsAction } from "@/lib/actions/settings";
import { cn } from "@/lib/utils";

type Prefs = {
  meetingsEnabled: boolean;
  meetingLeadMins: number[];
  tasksEnabled: boolean;
  taskLeadMins: number;
  digestEnabled: boolean;
  digestTime: string;
};

type Permission = "default" | "granted" | "denied" | "unsupported";

function labelForDevice(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone|iPad/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Mac OS X/.test(ua)
        ? "macOS"
        : /Windows/.test(ua)
          ? "Windows"
          : "this device";
  return `${browser} on ${os}`;
}

/**
 * VAPID keys arrive base64url; PushManager wants raw bytes.
 *
 * Typed as ArrayBuffer rather than Uint8Array because the DOM types insist on
 * a buffer backed by ArrayBuffer specifically, and a plain Uint8Array is
 * declared over ArrayBufferLike (which includes SharedArrayBuffer).
 */
function urlBase64ToBuffer(base64: string): ArrayBuffer {
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "=",
  );
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Reminders, and the one button in the app that asks for permission.
 *
 * Deliberately the only one. A permission prompt fired on page load is
 * answered "no" by reflex and can never be asked again, so it waits here,
 * behind a press, next to the explanation of what it is for.
 */
export function NotificationSettings({
  prefs,
  pushPublicKey,
}: {
  prefs: Prefs;
  pushPublicKey: string;
}) {
  const [local, setLocal] = useState<Prefs>(prefs);
  const [permission, setPermission] = useState<Permission>("default");
  const [subscribedHere, setSubscribedHere] = useState(false);
  const [devices, setDevices] = useState<
    { id: string; label: string; createdAt: string }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();

  useEffect(() => setLocal(prefs), [prefs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission as Permission);
    void navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribedHere(Boolean(sub)))
      .catch(() => setSubscribedHere(false));
  }, []);

  const loadDevices = () =>
    start(async () => {
      const res = await listPushDevicesAction();
      if (res.ok && res.data) setDevices(res.data.devices);
    });
  useEffect(loadDevices, []);

  const save = (patch: Partial<Prefs>) => {
    const next = { ...local, ...patch };
    setLocal(next);
    start(async () => {
      const res = await updateSettingsAction({ notifications: next });
      if (!res.ok) {
        toast.error(res.error);
        setLocal(local);
        return;
      }
      // Rebuild immediately. Waiting for the five-minute pass would mean a
      // toggle that appears to do nothing for five minutes.
      await refreshNotificationsAction();
    });
  };

  const enableHere = async () => {
    setBusy(true);
    try {
      const granted = await Notification.requestPermission();
      setPermission(granted as Permission);
      if (granted !== "granted") {
        toast.error("Notifications were blocked for this site");
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        // Required by every browser: a push must always be visible to the
        // user. Silent background pushes are not on offer, which is fine —
        // everything here is meant to be seen.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(pushPublicKey),
      });
      const res = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...sub.toJSON(), label: labelForDevice() }),
      });
      if (!res.ok) throw new Error("register failed");
      setSubscribedHere(true);
      loadDevices();
      toast.success("This device will get reminders");
    } catch {
      toast.error("Could not enable notifications here");
    } finally {
      setBusy(false);
    }
  };

  const disableHere = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        const mine = devices.find((d) => d.label === labelForDevice());
        if (mine) await removePushDeviceAction(mine.id);
        void endpoint;
      }
      setSubscribedHere(false);
      loadDevices();
      toast.success("Stopped on this device");
    } catch {
      toast.error("Could not turn it off here");
    } finally {
      setBusy(false);
    }
  };

  const iosNeedsInstall =
    typeof navigator !== "undefined" &&
    /iPhone|iPad/.test(navigator.userAgent) &&
    !window.matchMedia("(display-mode: standalone)").matches;

  return (
    <div className="flex flex-col gap-4">
      <Row
        label="Meetings"
        description="A reminder before each one, your own and any mirrored calendar."
      >
        <Switch
          checked={local.meetingsEnabled}
          onCheckedChange={(v) => save({ meetingsEnabled: v })}
        />
      </Row>
      {local.meetingsEnabled && (
        <Leads
          label="How long before"
          hint="Pick more than one for a heads-up and a nudge."
          selected={local.meetingLeadMins}
          onToggle={(m) => {
            const has = local.meetingLeadMins.includes(m);
            const next = has
              ? local.meetingLeadMins.filter((v) => v !== m)
              : [...local.meetingLeadMins, m];
            // Never empty: no lead times means meetings are on and silent,
            // which reads as broken rather than configured.
            save({ meetingLeadMins: next.length ? next.sort((a, b) => a - b) : [m] });
          }}
        />
      )}

      <div className="border-t border-border2 pt-3">
        <Row
          label="Tasks with a time"
          description="Only tasks due at a specific time. A date alone gets no alarm."
        >
          <Switch
            checked={local.tasksEnabled}
            onCheckedChange={(v) => save({ tasksEnabled: v })}
          />
        </Row>
        {local.tasksEnabled && (
          <Leads
            label="How long before"
            single
            selected={[local.taskLeadMins]}
            onToggle={(m) => save({ taskLeadMins: m })}
          />
        )}
      </div>

      <div className="border-t border-border2 pt-3">
        <Row
          label="Morning digest"
          description="One line with the day's count. Silent on days with nothing due."
        >
          <Switch
            checked={local.digestEnabled}
            onCheckedChange={(v) => save({ digestEnabled: v })}
          />
        </Row>
        {local.digestEnabled && (
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-[11px] text-faint2">At</span>
            <input
              type="time"
              value={local.digestTime}
              onChange={(e) => save({ digestTime: e.target.value })}
              className="rounded-lg border border-border bg-surface px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-faint"
            />
          </div>
        )}
      </div>

      <div className="border-t border-border2 pt-3">
        <p className="m-0 mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
          This device
        </p>
        {permission === "unsupported" ? (
          <p className="m-0 text-[12px] leading-relaxed text-faint">
            This browser cannot show notifications. Everything above still
            appears in the bell.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="m-0 text-[12px] leading-relaxed text-muted">
              {subscribedHere
                ? "Reminders reach you here even with PUMMA closed."
                : "Turn this on to get reminders when PUMMA is closed. Without it they wait in the bell."}
            </p>
            {permission === "denied" ? (
              <p className="m-0 font-mono text-[10.5px] leading-relaxed text-faint2">
                Blocked for this site. Your browser has to unblock it: click
                the padlock beside the address, then allow notifications.
              </p>
            ) : (
              <button
                type="button"
                disabled={busy || !pushPublicKey}
                onClick={() => void (subscribedHere ? disableHere() : enableHere())}
                className={cn(
                  "flex w-fit items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-semibold transition-colors disabled:opacity-50",
                  subscribedHere
                    ? "border-border bg-surface text-muted hover:border-faint hover:text-ink"
                    : "border-ink bg-ink text-background hover:bg-ink/90",
                )}
              >
                {subscribedHere ? (
                  <BellOff className="h-3.5 w-3.5" />
                ) : (
                  <Bell className="h-3.5 w-3.5" />
                )}
                {subscribedHere ? "Turn off here" : "Enable on this device"}
              </button>
            )}
            {!pushPublicKey && (
              <p className="m-0 font-mono text-[10.5px] leading-relaxed text-faint2">
                Push is not configured on this server, so reminders stay in the
                bell.
              </p>
            )}
            {iosNeedsInstall && (
              <p className="m-0 font-mono text-[10.5px] leading-relaxed text-faint2">
                On iPhone, add PUMMA to your Home Screen first — Safari only
                allows notifications for installed apps.
              </p>
            )}
          </div>
        )}

        {devices.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {devices.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
              >
                <Bell className="h-3.5 w-3.5 shrink-0 text-faint2" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                  {d.label}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${d.label}`}
                  onClick={() =>
                    start(async () => {
                      await removePushDeviceAction(d.id);
                      loadDevices();
                    })
                  }
                  className="shrink-0 text-faint2 transition-colors hover:text-tasks"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="m-0 text-[13px] font-semibold text-ink">{label}</p>
        <p className="m-0 text-[11.5px] leading-relaxed text-faint">
          {description}
        </p>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function Leads({
  label,
  hint,
  selected,
  single,
  onToggle,
}: {
  label: string;
  hint?: string;
  selected: number[];
  single?: boolean;
  onToggle: (mins: number) => void;
}) {
  return (
    <div className="mt-2">
      <p className="m-0 mb-1.5 font-mono text-[10px] uppercase tracking-widest text-faint2">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {LEAD_CHOICES.map((m) => {
          const on = selected.includes(m);
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              onClick={() => onToggle(m)}
              // Same non-flicker recipe as every other chip: the border stays
              // 1px and the weight comes from an inset shadow.
              className={cn(
                "rounded-[7px] border px-2.5 py-1 font-mono text-[11px] font-semibold transition-[color,background-color,border-color,box-shadow] duration-150",
                on
                  ? "animate-chip-pick border-primary bg-primary/[0.12] text-primary"
                  : "border-border bg-surface text-muted hover:border-faint hover:text-ink",
              )}
            >
              {m === 0 ? "On time" : m < 60 ? `${m} min` : "1 hour"}
            </button>
          );
        })}
      </div>
      {hint && !single && (
        <p className="m-0 mt-1.5 font-mono text-[10px] text-faint2">{hint}</p>
      )}
    </div>
  );
}
