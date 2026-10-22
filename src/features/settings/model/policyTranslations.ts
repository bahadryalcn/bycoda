/** Turkish in-app translations; repository policy documents remain English. */
export const turkishPolicies = {
  privacy: `# Gizlilik politikası

Son güncelleme: 11 Ekim 2026

## Kapsam ve iletişim

Bu politika, [bahadryalcn](https://github.com/bahadryalcn) tarafından bağımsız olarak sürdürülen bycoda masaüstü uygulamasını ve kendi sunucunuzda çalıştırdığınız yardımcı host'u açıklar. Gizlilik soruları ve talepleri için [info@bahadrhllyalcn.com](mailto:info@bahadrhllyalcn.com) adresine yazabilirsiniz. Genel sorular için GitHub kullanılabilir; herkese açık issue'lara kişisel bilgi, kimlik bilgisi, özel kod veya konuşma kayıtları koymayın.

## Geliştirici veri toplamıyor veya kullanıcıları takip etmiyor

bycoda hesabı açmanız gerekmez. Uygulama projelerinizi, konuşmalarınızı, kimlik bilgilerinizi veya kullanım geçmişinizi bakımcıya göndermez. Geliştiricinin işlettiği davranış takibi, reklam, analitik veya otomatik hata raporu gönderimi içermez. Bakımcı etkinliğinizi izlemez, verilerinizi satmaz ve içeriğinizi model eğitimi için kullanmaz.

Bu, uygulamanın hiç veri saklamadığı veya ağa hiç bağlanmadığı anlamına gelmez. Veriler cihazlarınızda; bağlı özellikler çalıştığında ise kullandığınız sağlayıcılarda ve host'larda işlenir.

## Cihazlarınızdaki veriler

Uygulama verdiğiniz izinler kapsamında dosya ve klasörleri okur. Ayarları, proje yollarını, konuşmaları, oturum durumunu, notları, kullanım sayaçlarını, entegrasyon bilgilerini ve tanılama bilgilerini yerel olarak saklar. Ajan araçları izinleri kapsamında dosya okuyabilir, değiştirebilir ve komut çalıştırabilir. Sağlayıcı CLI'ları kendi geçmiş, günlük ve kimlik doğrulama dosyalarını da tutabilir.

Geçmiş, uygulama veri klasöründeki bycoda.db gibi yerel depolarda tutulur; tercihler webview yerel depolamasında da bulunabilir. Bağlı host'ların kendi veritabanları ve günlükleri vardır. Kimlik bilgileri ilgili entegrasyon, sağlayıcı CLI'ı veya yerel kimlik bilgisi deposunda yönetilir. Sosyal entegrasyon token'ları işletim sisteminin koruduğu bir anahtarla yerel olarak şifrelenmiş kasada saklanır. Bu, bütün yerel dosya, günlük ve veritabanlarının şifrelendiği garantisi değildir.

## Ağ erişimi ve üçüncü taraflar

Yapay zekâ ajanları ve sağlayıcı CLI'ları istemleri, seçilen bağlamı, ekleri, kodu ve araç sonuçlarını oturum için yapılandırılmış sağlayıcıya veya uç noktaya gönderir. Saklama, eğitim, telemetri, ücretlendirme ve gizlilik kurallarını bycoda değil, ilgili sağlayıcı ve hesap ayarlarınız belirler.

Git, gelen kutusu, MCP, tarayıcı ve sosyal özellikler işlerini yapmak için gerekli verileri yapılandırdığınız servislerle paylaşır. İzinlere bağlı olarak depo bilgileri, işler, mesajlar, hesap kimlikleri, gönderiler, yorumlar ve medya işlenebilir. Bağlı servisler arka planda sorgulanabilir; yetkilendirilmiş zamanlanmış görevler daha sonra çalışabilir. Uzak erişim ve eşitleme, çalışma alanı/oturum verilerini eşleştirdiğiniz cihazlarla veya host'larla paylaşır. Bu host'lar bakımcının değil, sizin veya host işletmecisinin kontrolündedir.

Güncellemelerin etkin olduğu sürümlerde kontrol ve indirmeler GitHub sürüm altyapısına bağlanır. Kayıt dizinlerini keşfetme, kurulum, dış bağlantılar ve uzak görseller ilgili servislere bağlanabilir. Bu servisler IP adresiniz ve istek bilgileri gibi olağan bağlantı verilerini alır ve kendi politikalarını uygular. Paketlenmiş politikaları okumak ağ isteği gerektirmez. Sağlayıcı bağlantıları üçüncü taraflar ve veri kontrolleri metninde bulunur.

## İsteğe bağlı sosyal ve YouTube özellikleri

Sosyal hesap bağlantısı, verdiğiniz izinler kapsamında desteklenen API işlemlerini sağlar: hesap/kanal bilgileri, yorum veya mesaj okuma; medya yükleme, gönderi yayımlama veya yanıt verme. Bu veriler cihazınızda veya seçtiğiniz host'ta tutulur ve platformla paylaşılır. Analitik veya reklam amacıyla bakımcıya gönderilmez.

YouTube entegrasyonu YouTube API Hizmetlerini kullanır. Google'ın işlemesine [Google Gizlilik Politikası](https://policies.google.com/privacy) uygulanır. Yetkilendirmeyi [Google hesap izinlerinden](https://security.google.com/settings/security/permissions) iptal edebilirsiniz. YouTube özellikleri [YouTube Hizmet Şartlarına](https://www.youtube.com/t/terms) da tabidir.

## Saklama, silme ve kontrol

Yerel veriler, mevcut kontrollerle veya ilgili uygulama/sağlayıcı/host depolarını kaldırarak silene kadar kalır. Bütün veriler için ortak bir otomatik son kullanma süresi yoktur. Arşivlemek veya gizlemek silmek değildir. Çalışma alanı kaydını kaldırmak proje dosyalarını, sağlayıcı geçmişini, yedekleri veya uzak kopyaları mutlaka silmez. Uygulamayı kaldırmak veri klasörünü bırakabilir.

Kullanmadığınız hesapların bağlantısını kesin, zamanlanmış/arka plan işlerini durdurun, sağlayıcıdan erişimi iptal edin ve gereksiz verileri her cihaz ve host'tan kaldırın. Sosyal hesap bağlantısını kesmek yerel token'ı siler ve hesabı duraklatır; hesap bilgileri ve önceden saklanmış sosyal kayıtlar kalır. Yayımlanmış gönderiler veya platformun tuttuğu veriler silinmez. Tam yerel sıfırlama için uygulama ve host'u durdurun, tutmak istediğiniz verileri yedekleyin ve uygulama verileriyle ilgili sağlayıcı depolarını kaldırın. Bu işlem yıkıcıdır ve birden fazla hesabı etkiler. Platformdaki içerikleri platformun kendi kontrolleriyle silin.

Bakımcı yerel çalışma alanınızı inceleyemez veya uzaktan silemez. Yardım ya da bakımcıya gönüllü gönderdiğiniz bilgilerle ilgili talepler için yukarıdaki adrese yazın. Bağlı sağlayıcıların kayıtları için ilgili sağlayıcıya da başvurun. Uygulanabilir veri koruma hakları; erişim, düzeltme, silme, itiraz ve yetkili makama şikâyet hakları bu politikayla kaldırılmaz.

## Gönüllü iletişim ve değişiklikler

E-posta, issue, tanılama dosyası veya destek materyali gönderirseniz bakımcı seçerek paylaştığınız bilgileri alır ve talebi yanıtlamak için kullanır. E-posta ve GitHub kendi politikalarıyla çalışır. Yazışmalar yalnızca talebi ele almak ve gerekli güvenlik/proje kayıtlarını tutmak için gereken süre boyunca saklanır. Gereken en az bilgiyi gönderin, günlükleri paylaşmadan önce sırları çıkarın.

Değişiklikler tarihlendirilerek depoda yayımlanır ve sonraki uygulama sürümlerine eklenir. Bu metin bağlandığınız servislerin politikalarını değiştirmez.`,
  terms: `# Kullanım koşulları

Son güncelleme: 11 Ekim 2026

## Yazılım ve lisans

bycoda, kurulu ajan araçları ve isteğe bağlı entegrasyonlar için bağımsız olarak sürdürülen açık kaynak masaüstü çalışma alanıdır. Deponun MIT lisansıyla sunulur. Bu koşullar kullanım açıklamasıdır; lisansın verdiği izinleri daraltmaz veya üçüncü taraf lisans bildirimlerinin yerini almaz. MIT lisansı uygulamada paketlenir ve depoda LICENSE dosyasında bulunur.

## İşlemleriniz ve izinleriniz

Bağlanacak projeleri, hesapları, sağlayıcıları, araçları, host'ları ve verilecek izin/onayları siz seçersiniz. Yalnızca yetkiniz olan veri ve servislere erişin. Ajan ve araçlar izinleri kapsamında dosya değiştirebilir, komut çalıştırabilir, bağlam aktarabilir ve yayımlama dahil dış işlemler yapabilir. Zamanlanmış ve arka plan işlemleri her adımı izlemeden devam edebilir. Yapılandırmayı ve sonuçları inceleyin, yedek alın ve kimlik bilgilerinizi koruyun.

Yapay zekâ çıktıları yanlış, eksik veya güvensiz olabilir. Üretilen kod ve içeriği kullanmadan veya üretim ortamına almadan önce incelemek sizin sorumluluğunuzdadır. bycoda hukuki, mali veya başka bir mesleki danışmanlık sunmaz.

## Üçüncü taraf servisler

Sağlayıcı hesapları, API anahtarları, abonelikler, kotalar, ücretler ve koşullar sizinle ilgili servis arasındadır. Bakımcı bu servisleri işletmez, kullanılabilirliğini veya çıktılarını garanti etmez. Sağlayıcı API/izin değişiklikleri özellikleri değiştirebilir veya çalışmasını durdurabilir. YouTube API özelliklerini kullanırken [YouTube Hizmet Şartları](https://www.youtube.com/t/terms) geçerlidir. Diğer platformların koşulları da uygulanır.

## Garanti verilmemesi ve sorumluluk sınırı

MIT lisansında belirtildiği gibi yazılım OLDUĞU GİBİ sunulur; ticarete elverişlilik, belirli amaca uygunluk ve hak ihlal etmeme dahil açık veya örtülü hiçbir garanti verilmez. Bakımcı kesintisiz çalışma, hatasız sonuç, veri kurtarma veya belirli bir sonuç vaat etmez.

Uygulanabilir hukukun izin verdiği en geniş ölçüde ve MIT lisansıyla uyumlu olarak; yazarlar, telif hakkı sahipleri ve bakımcı yazılımdan veya kullanımından doğan talepler, zararlar ve diğer sorumlulukları kabul etmez. Buna veri kaybı, ajan işlemleri, üretilen içerik, servis ücretleri ve üçüncü taraf arızaları dahildir. Hukuken kaldırılamayan sorumluluklar veya zorunlu tüketici/veri koruma hakları bu metinle kaldırılmaz.

## Gizlilik, güvenlik ve iletişim

Gizlilik politikası yerel depolama ve bağlı servisleri açıklar. Güvenlik açıklarını özel kanaldan bildirin; sırları veya istismar ayrıntılarını açık issue'larda yayımlamayın. Gizlilik, güvenlik ve diğer sorular için [info@bahadrhllyalcn.com](mailto:info@bahadrhllyalcn.com) adresine yazın veya [bakımcının GitHub profilini](https://github.com/bahadryalcn) ziyaret edin.

## Değişiklikler

Değişiklikler depoda tarihlendirilir ve sonraki uygulama sürümlerine eklenir. Bu koşullar sertifikasyon, mevzuata uygunluk, sağlayıcı onayı veya hizmet seviyesi anlaşması iddiası içermez.`,
  thirdParty: `# Üçüncü taraflar ve veri kontrolleri

Son güncelleme: 11 Ekim 2026

## Bağlantıları siz seçersiniz

Bakımcı uygulama kullanımını takip etmez ve çalışma alanınız için merkezi veri deposu işletmez. Bağlı servisler özellikleri çalıştığında veri alır ve kendi kurallarını uygular. Kullandığınız sağlayıcı, CLI, MCP sunucusu, özel uç nokta veya kendi sunucunuzdaki servisin gizlilik ve hesap ayarlarını inceleyin; bu liste tüm servisleri kapsamaz.

## Sağlayıcı gizlilik bağlantıları

- OpenAI / Codex: [gizlilik politikası](https://openai.com/policies/privacy-policy/).
- Anthropic / Claude: [gizlilik politikası](https://www.anthropic.com/legal/privacy).
- Google / Gemini / YouTube: [gizlilik politikası](https://policies.google.com/privacy).
- GitHub / Copilot / sürümler: [gizlilik bildirimi](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
- GitLab: [gizlilik bildirimi](https://about.gitlab.com/privacy/).
- Atlassian / Jira: [gizlilik politikası](https://www.atlassian.com/legal/privacy-policy).
- Linear: [gizlilik politikası](https://linear.app/privacy).
- Microsoft / Azure DevOps: [gizlilik bildirimi](https://privacy.microsoft.com/privacystatement).
- Meta / Facebook / Instagram: [gizlilik politikası](https://www.facebook.com/privacy/policy/).
- X: [gizlilik politikası](https://x.com/en/privacy).
- LinkedIn: [gizlilik politikası](https://www.linkedin.com/legal/privacy-policy).

Sağlayıcı politikaları ve hesap yapılandırmaları değişebilir. Saklama, model eğitimi, işleme konumları ve ücretlerini bycoda belirlemez.

## Erişimi durdurma ve veri silme

İlgili görevleri durdurun ve kullanılmayan entegrasyonları ayırın. bycoda bağlantısını kesmenin yanında servisin hesap ayarlarından izin/token'ları da iptal edin. Google / YouTube yetkisini [Google hesap izinlerinden](https://security.google.com/settings/security/permissions) kaldırabilirsiniz.

Sosyal hesap bağlantısını kesmek yerel token'ı kaldırır ve hesabı duraklatır. Hesap bilgileri ve saklanmış sosyal kayıtlar kalır. Yayımlanmış gönderi, yorum veya videolar silinmez; sağlayıcıdaki yetkilendirme kendiliğinden iptal edilmez. Bunları platformdan yönetin. YouTube özellikleri YouTube API Hizmetlerini kullanır ve [YouTube Hizmet Şartlarına](https://www.youtube.com/t/terms) tabidir.

Konuşmaları ve diğer kayıtları mevcut kontrollerle silin. Gizleme ve arşivleme verileri tutar. Yerel veritabanları, webview tercihleri, tanılama günlükleri, sağlayıcı CLI geçmişi ve host kopyaları ayrı depolardır. Uygulamayı kaldırmak bunların silinmesini garanti etmez. Tam sıfırlama için uygulama ve host'u durdurun, gereken verileri yedekleyin ve bycoda.db ile varsa sosyal kimlik bilgisi kasası dahil uygulama verilerini kaldırın. Sağlayıcı depolarını, eşleştirilmiş cihazları ve yedekleri de inceleyin. Uygulama verilerini kaldırmak bütün yerel oturum ve ayarları silebilir; tercihleri sıfırlamak için proje klasörlerini silmeyin.

Bakımcıya gönüllü gönderilmiş bilgilerle ilgili talepler [info@bahadrhllyalcn.com](mailto:info@bahadrhllyalcn.com) adresine gönderilebilir. Bakımcı cihazlarınıza uzaktan erişemez; yerel verileri veya üçüncü taraf kayıtlarını sizin adınıza silemez.`,
};
