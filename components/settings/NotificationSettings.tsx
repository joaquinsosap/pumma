"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bell, BellOff, Check, Trash2 } from "@/components/icons";
import { Switch } from "@/components/ui/switch";
import { LEAD_CHOICES } from "@/lib/notifications";
import {
  listPushDevicesAction,
  refreshNotificationsAction,
  removePushDeviceAction,
} from "@/lib/actions/notifications";
import { updateSettingsAction } from "@/lib/actions/settings";
import { isIos, isStandalone } from "@/lib/pwa";
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

  /**
   * Subscribe this browser to push, so reminders arrive with PUMMA closed.
   *
   * Separate from permission on purpose. Permission alone already buys the
   * useful middle tier — banners while a tab is open behind something else —
   * and it works with no VAPID keys, no subscription and no server push. Push
   * is the extra step that survives closing the app, and it should not be a
   * precondition for the thing that needs none of it.
   */
  const subscribeHere = async () => {
    if (!pushPublicKey) return false;
    const reg = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      // Required by every browser: a push must always be visible to the user.
      // Silent background pushes are not on offer, which is fine — everything
      // here is meant to be seen.
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
    return true;
  };

  /**
   * One press, best available outcome.
   *
   * Asks for permission, and then goes as far as this server can: with push
   * configured it also subscribes, and without it stops at permission, which
   * still leaves reminders working in every case except the app being fully
   * closed. Previously this button was DISABLED whenever push was
   * unconfigured, which withheld the tier that needed nothing from the server
   * at all.
   */
  const enableHere = async () => {
    setBusy(true);
    try {
      const granted = await Notification.requestPermission();
      setPermission(granted as Permission);
      if (granted !== "granted") {
        toast.error("Notifications were blocked for this site");
        return;
      }
      let pushed = false;
      try {
        pushed = await subscribeHere();
      } catch {
        // Permission is granted either way, so the middle tier is live even
        // when the push half fails. Saying "could not enable" here would be
        // a lie about something that just started working.
        pushed = false;
      }
      toast.success(
        pushed
          ? "Reminders on, even with PUMMA closed"
          : "Reminders on while PUMMA is open",
      );
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

  // Computed in an effect rather than during render: both checks touch
  // window, and reading them while rendering makes the server and the client
  // disagree about what to draw.
  const [iosNeedsInstall, setIosNeedsInstall] = useState(false);
  useEffect(() => {
    setIosNeedsInstall(isIos() && !isStandalone());
  }, []);

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
            {/* Says which of the three tiers is actually live, rather than
                one sentence that is only true in some configurations. */}
            <Reach
              granted={permission === "granted"}
              subscribed={subscribedHere}
            />
            {permission === "denied" ? (
              <p className="m-0 font-mono text-[10.5px] leading-relaxed text-faint2">
                Blocked for this site. Your browser has to unblock it: click
                the padlock beside the address, then allow notifications.
              </p>
            ) : permission !== "granted" ? (
              <button
                type="button"
                // No longer gated on pushPublicKey. Permission alone earns
                // banners while a tab is open behind something else, and that
                // needs nothing from the server.
                disabled={busy}
                onClick={() => void enableHere()}
                className="flex w-fit items-center gap-1.5 rounded-lg border border-ink bg-ink px-3 py-2 text-[12.5px] font-semibold text-background transition-colors hover:bg-ink/90 disabled:opacity-50"
              >
                <Bell className="h-3.5 w-3.5" />
                Allow notifications here
              </button>
            ) : subscribedHere ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void disableHere()}
                className="flex w-fit items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] font-semibold text-muted transition-colors hover:border-faint hover:text-ink disabled:opacity-50"
              >
                <BellOff className="h-3.5 w-3.5" />
                Stop when PUMMA is closed
              </button>
            ) : pushPublicKey ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void subscribeHere()
                    .then((ok) => {
                      if (ok) toast.success("Also when PUMMA is closed");
                    })
                    .catch(() => toast.error("Could not turn that on"))
                    .finally(() => setBusy(false));
                }}
                className="flex w-fit items-center gap-1.5 rounded-lg border border-ink bg-ink px-3 py-2 text-[12.5px] font-semibold text-background transition-colors hover:bg-ink/90 disabled:opacity-50"
              >
                <Bell className="h-3.5 w-3.5" />
                Also when PUMMA is closed
              </button>
            ) : null}
            {!pushPublicKey && permission === "granted" && (
              <p className="m-0 font-mono text-[10.5px] leading-relaxed text-faint2">
                Delivery with PUMMA fully closed is not configured on this
                server, so that last step is unavailable here.
              </p>
            )}
            {iosNeedsInstall && (
              <p className="m-0 font-mono text-[10.5px] leading-relaxed text-faint2">
                On iPhone this needs PUMMA on your Home Screen first: Apple
                does not allow notifications for a site in a browser tab.{" "}
                <a
                  href="#install"
                  className="font-semibold text-primary underline decoration-primary/40 underline-offset-2 hover:decoration-primary"
                >
                  How to install
                </a>
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

/**
 * How far reminders currently reach on this device.
 *
 * Three tiers, and the honest answer is different in each. One sentence
 * covering all of them ended up being wrong in two.
 */
function Reach({
  granted,
  subscribed,
}: {
  granted: boolean;
  subscribed: boolean;
}) {
  const lines: [string, boolean][] = [
    ["While you are looking at PUMMA", true],
    ["While a PUMMA tab is open behind something else", granted],
    ["With PUMMA closed", subscribed],
  ];
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-0">
      {lines.map(([label, on]) => (
        <li
          key={label}
          className="flex items-center gap-2 text-[12px] leading-relaxed"
        >
          {on ? (
            <Check
              className="h-3.5 w-3.5 shrink-0 text-habits"
              strokeWidth={2.5}
            />
          ) : (
            <span
              aria-hidden
              className="h-3.5 w-3.5 shrink-0 text-center font-mono text-[11px] leading-[14px] text-faint2"
            >
              ·
            </span>
          )}
          <span className={on ? "text-ink" : "text-faint2"}>{label}</span>
        </li>
      ))}
    </ul>
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
