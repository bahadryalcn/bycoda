import type { SocialPublishingPlan } from "./social";

export type PublishingScheduleFields = {
  timeZone: string;
  startTime: string;
  endTime: string;
  minHours: string;
  maxHours: string;
};

export function localPublishingTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Istanbul";
}

export function scheduleFields(
  schedule: SocialPublishingPlan["schedule"],
): PublishingScheduleFields {
  return {
    timeZone: schedule.timeZone,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    minHours: String(schedule.minIntervalMinutes / 60),
    maxHours: String(schedule.maxIntervalMinutes / 60),
  };
}

/** The browser mirrors host validation; the host owns scheduling and authorization. */
export function publishingSchedule(fields: PublishingScheduleFields): {
  schedule?: SocialPublishingPlan["schedule"];
  error?: string;
} {
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.startTime) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.endTime)
  )
    return { error: "Başlangıç ve bitiş saatini girin." };
  const timeZone = fields.timeZone.trim();
  try {
    new Intl.DateTimeFormat("tr-TR", { timeZone }).format(0);
  } catch {
    return { error: "Geçerli bir saat dilimi girin. Örnek: Europe/Istanbul." };
  }
  const minIntervalMinutes = Number(fields.minHours) * 60;
  const maxIntervalMinutes = Number(fields.maxHours) * 60;
  if (
    !fields.minHours.trim() ||
    !fields.maxHours.trim() ||
    !Number.isInteger(minIntervalMinutes) ||
    !Number.isInteger(maxIntervalMinutes) ||
    minIntervalMinutes < 1 ||
    maxIntervalMinutes > 10080
  )
    return {
      error:
        "Süreleri tam dakika karşılığı olacak şekilde girin. En kısa süre en az 1 dakika, en uzun süre en fazla 168 saat olabilir.",
    };
  if (minIntervalMinutes > maxIntervalMinutes)
    return { error: "En kısa süre, en uzun süreden büyük olamaz." };
  return {
    schedule: {
      timeZone,
      startTime: fields.startTime,
      endTime: fields.endTime,
      minIntervalMinutes,
      maxIntervalMinutes,
    },
  };
}

export function publishingScheduleSummary(schedule: SocialPublishingPlan["schedule"]) {
  const window =
    schedule.startTime === schedule.endTime
      ? "günün tamamında"
      : `${schedule.startTime}–${schedule.endTime} arasında${schedule.startTime > schedule.endTime ? " (gece yarısını geçer)" : ""}`;
  const minHours = schedule.minIntervalMinutes / 60;
  const maxHours = schedule.maxIntervalMinutes / 60;
  const interval =
    minHours === maxHours
      ? `${minHours} saatte bir`
      : `en az ${minHours}, en çok ${maxHours} saat arayla`;
  const outsideWindow =
    schedule.startTime === schedule.endTime
      ? ""
      : " Aralık yayın saatleri içinde uygulanır; süre pencere dışına taşarsa yayın bir sonraki başlangıç saatini bekler.";
  return `Her gün ${window}, ${interval}. Saat dilimi: ${schedule.timeZone}.${outsideWindow}`;
}

export function publishingPlanTime(value: number | undefined, timeZone: string) {
  if (value === undefined || !Number.isFinite(value)) return "—";
  try {
    return new Intl.DateTimeFormat("tr-TR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone,
    }).format(value);
  } catch {
    return "—";
  }
}

export type PublishingPauseFeedback = {
  status: "paused" | "review" | "completed";
  kind: "info" | "warning" | "success";
  title: string;
  message: string;
  technicalDetail?: string;
};

/** Translate known host outcomes; unknown diagnostics remain an optional detail. */
export function publishingPauseFeedback(reason?: string): PublishingPauseFeedback {
  const value = reason?.trim() ?? "";
  if (!value || value === "Paused by owner.")
    return {
      status: "paused",
      kind: "info",
      title: value ? "Plan sizin tarafınızdan durduruldu" : "Plan durdurulmuş",
      message:
        "Hazır olduğunuzda saatleri ve içerik havuzunu kontrol edip otomatik yayını yeniden etkinleştirin.",
    };
  if (value === "Review the campaign pool and explicitly activate this plan.")
    return {
      status: "review",
      kind: "info",
      title: "Plan etkinleştirme onayı bekliyor",
      message:
        "İçerik havuzunu ve saatleri inceleyin; plan onayını işaretleyip otomatik yayını etkinleştirin.",
    };
  if (value === "Publishing plan was edited. Review the new schedule and pool.")
    return {
      status: "review",
      kind: "info",
      title: "Plan değişiklikleri onay bekliyor",
      message: "Yeni saatleri ve içerik havuzunu inceleyip otomatik yayını yeniden etkinleştirin.",
    };
  if (
    value.startsWith("All approved pool campaigns were published.") ||
    value.startsWith("Publishing pool is complete.")
  )
    return {
      status: "completed",
      kind: "success",
      title: "İçerik havuzu tamamlandı",
      message: "Yeni paylaşım için plana yeni onaylı kampanyalar ekleyin.",
    };
  if (value.startsWith("Publishing account is paused, disconnected or assigned to another host."))
    return {
      status: "review",
      kind: "warning",
      title: "Hesap bağlantısı kontrol edilmeli",
      message:
        "Hesaplar bölümünden bağlantıyı ve hesabın çalıştığı host'u kontrol edin, hesabı devam ettirip planı yeniden etkinleştirin.",
    };
  if (
    value.startsWith("Project publication permission was revoked.") ||
    value.startsWith("Every campaign project needs publication permission")
  )
    return {
      status: "review",
      kind: "warning",
      title: "Proje yayın izni gerekli",
      message:
        "Hesaplar bölümünde kampanyaların tüm projelerine yayın izni verip planı yeniden etkinleştirin.",
    };
  if (
    value.startsWith("Publishing policy, account permissions or plan changed.") ||
    value.startsWith("Publishing authorization changed.")
  )
    return {
      status: "review",
      kind: "warning",
      title: "Yayın ayarları veya izinleri değişti",
      message:
        "Hesap izinlerini, içerik sınırlarını ve planı kontrol edin; plan onayını yenileyip otomatik yayını etkinleştirin.",
    };
  if (value.startsWith("Campaign pool approval changed."))
    return {
      status: "review",
      kind: "warning",
      title: "İçerik onayı yenilenmeli",
      message:
        "Kampanyalar bölümünde değişen içeriklere yeniden yayın onayı verin. Planı düzenleyip güncel içerik havuzunu kaydedin.",
    };
  if (
    /^(OAuth token expired\.|Account credentials expired\.|Credentials expired\.|Browser session expired\.|expired$|SocialPlatformError: expired)/i.test(
      value,
    )
  )
    return {
      status: "review",
      kind: "warning",
      title: "Hesap bağlantısının süresi doldu",
      message: "Hesaplar bölümünden yeniden giriş yapın ve planı tekrar etkinleştirin.",
    };
  if (value.startsWith("Waiting for OAuth scopes/API access:"))
    return {
      status: "review",
      kind: "warning",
      title: "Platform yayın erişimi gerekli",
      message:
        "Hesaplar bölümündeki kullanılabilir işlemleri kontrol edin ve platformun istediği yayın erişimini tamamlayın.",
    };
  if (
    value.startsWith("A pool campaign was scheduled elsewhere.") ||
    value.startsWith("A pool campaign is already scheduled or dispatched.")
  )
    return {
      status: "review",
      kind: "warning",
      title: "İçerik başka bir yayında kullanılıyor",
      message:
        "Geçmiş bölümünden mevcut yayını kontrol edin. Aynı içeriğin tekrar gönderilmemesi için havuza yeni, yayınlanmamış kampanyalar seçin.",
    };
  if (
    value.startsWith("Publication did not complete.") ||
    value.startsWith("Resolve the existing publication outcome") ||
    value === "Send outcome requires review."
  )
    return {
      status: "review",
      kind: "warning",
      title: "Yayın sonucu incelenmeli",
      message:
        "Geçmiş bölümünden son yayının sonucunu kontrol edin. Sonucu kesinleşmeden aynı içeriği yeniden göndermeyin; gerekli düzeltmeden sonra planı yeniden etkinleştirin.",
    };
  return {
    status: "review",
    kind: "warning",
    title: "Plan için kontrol gerekli",
    message:
      "Hesap bağlantısını, yayın izinlerini ve Geçmiş bölümündeki son sonucu kontrol edip planı yeniden inceleyin.",
    technicalDetail: value,
  };
}
