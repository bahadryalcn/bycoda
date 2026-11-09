/** Turkish in-app translations; repository policy documents remain English. */
export const turkishPolicies = {
  privacy: `# Gizlilik politikası

Son güncelleme: 9 Kasım 2026

## Kapsam ve iletişim

Bu politika, [bahadryalcn](https://github.com/bahadryalcn) tarafından bağımsız olarak sürdürülen bycoda masaüstü uygulamasını, bycoda mobil uygulamasını, isteğe bağlı bycoda hesabını (account.bycoda.codes hesap portalı dahil), bycoda.codes web sitesini ve kendi sunucunuzda çalıştırdığınız yardımcı host'u açıklar.

Veri sorumlusu: bycoda'yı bağımsız olarak geliştiren ve sürdüren geliştirici (GitHub: [bahadryalcn](https://github.com/bahadryalcn)), bu politikaya göre bakımcıya ulaşan veriler bakımından 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) kapsamında veri sorumlusu, Avrupa Birliği Genel Veri Koruma Tüzüğü (GDPR) kapsamında ise sorumludur. İletişim: [info@bycoda.codes](mailto:info@bycoda.codes). Resmi başvurular için veri sorumlusunun ad-soyadı ve posta adresi, bu adrese yapılacak talep üzerine bildirilir.

Gizlilik soruları ve talepleri için [info@bycoda.codes](mailto:info@bycoda.codes) adresine yazabilirsiniz. Genel sorular için GitHub kullanılabilir; herkese açık issue'lara kişisel bilgi, kimlik bilgisi, özel kod veya konuşma kayıtları koymayın.

## bycoda neyi toplar, neyi toplamaz

bycoda'yı hesap açmadan kullanabilirsiniz. Hesap olmadan uygulama projelerinizi, konuşmalarınızı, kimlik bilgilerinizi veya kullanım geçmişinizi bakımcıya göndermez; reklam, davranış takibi veya otomatik hata raporu gönderimi içermez. Hesap olmadan gönderebileceği tek şey aşağıda açıklanan, varsayılan olarak kapalı isteğe bağlı anonim istatistik sinyalidir.

Bir bycoda hesabı oluşturursanız bakımcı aşağıdaki bölümlerde açıklanan sınırlı hesap verilerini alır ve saklar: hesap profiliniz, cihazlarınız, her cihazın günde kaç dakika etkin olduğu ve bildirim ayarlarınız.

Hesapla da hesapsız da asla toplanmayanlar: oturum içeriği, istemler, model yanıtları, kod, dosya içerikleri, dosya yolları, proje adları, depo adları, ekranda gösterilen şeyler, kimlik bilgileri, e-posta ve sohbet mesajlarınızın içeriği. Verilerinizi satmaz, reklam için kullanmaz ve içeriğinizi model eğitimi için kullanmayız.

Bu, uygulamanın hiç veri saklamadığı veya ağa hiç bağlanmadığı anlamına gelmez. Veriler cihazlarınızda; bağlı özellikler çalıştığında ise kullandığınız sağlayıcılarda ve host'larda işlenir.

## bycoda hesabınız

Hesap isteğe bağlı ve ücretsizdir. Google, GitHub veya e-posta koduyla giriş yapabilirsiniz; parola yoktur (aşağıdaki "Google, GitHub veya e-posta koduyla giriş" bölümüne bakın). Girişi kimlik sağlayıcımız Clerk yürütür ve Clerk bizim adımıza veri işleyen olarak çalışır. Google veya GitHub ile girişte o sağlayıcı, paylaşmanıza izin verdiğiniz profil bilgilerini Clerk'e iletir. Hesapları korumak için kimlik işleyicimiz Clerk, oturum açma oturumlarınızı IP adresi, yaklaşık konum ve tarayıcı/cihaz bilgisiyle kaydeder ve bunları size Güvenlik → Etkin cihazlar altında gösterir. bycoda'nın kendi veritabanı IP adreslerini saklamaz. Hesap güvenliği ve toplu istatistik için sunucularımız yalnızca her girişin ve cihaz kaydının ülkesini saklar; bu ülke ağ sağlayıcımız Cloudflare tarafından IP adresinden türetilir, IP adresinin kendisi saklanmaz. Ülke bilgisi 180 gün tutulur; hesap portalındaki Güvenlik etkinliği sayfası son 90 günü size gösterir.

Şunları saklarız: kullanıcı kimliği, e-posta adresiniz, görünen adınız, giriş sağlayıcı sunuyorsa profil resmi adresi, hesaba bağlı giriş yöntemleri, seçtiğiniz dil ve saat dilimi, hesabın oluşturulma zamanı ve bildirim tercihleriniz. Masaüstü ve mobil uygulamalar giriş token'larınızı düz dosyada değil, işletim sisteminin güvenli kimlik bilgisi deposunda tutar.

Amaç: birden çok cihazda giriş yapmanızı, bu cihazları görmenizi ve oturumlarını kapatmanızı, etkin sürenizi görmenizi, istediğiniz bildirimleri almanızı sağlamak ve hizmeti güvenli ve çalışır tutmak.

## Google, GitHub veya e-posta koduyla giriş

Google, GitHub veya e-posta adresinize gönderilen tek kullanımlık kodla giriş yapabilirsiniz. (Etkin olduğu yerlerde Apple veya Facebook ile giriş de sunulabilir; aynı kurallar geçerlidir.) Oluşturmanız veya saklamanız gereken bir parola yoktur.

- Google veya GitHub: bunlardan birini seçtiğinizde ilgili sağlayıcı sizi doğrular ve paylaşmasına izin verdiğiniz profil bilgilerini Clerk'e iletir: adınız, e-posta adresiniz, profil resminiz ve sağlayıcıdaki hesap kimliğiniz. Bunları Clerk üzerinden alırız ve yukarıdaki "bycoda hesabınız" bölümünde sayılanlardan fazlasını saklamayız. Google veya GitHub parolanızı asla görmeyiz. Giriş, Google veya GitHub içeriğinize, depolarınıza, kişilerinize ya da postanıza erişim vermez; yalnızca kim olduğunuzu doğrular.
- E-posta kodu: e-posta adresinizi Clerk'e verirsiniz ve Clerk o adrese tek kullanımlık bir kod gönderir. Yalnızca e-posta adresiniz işlenir.
- Google ve GitHub, girişin kendi tarafı için kendi gizlilik politikaları ve koşulları uyarınca hareket eder.
- Bağlantıyı kesme: account.bycoda.codes hesap portalında Güvenlik sayfasını açarak bağlı giriş yöntemlerinizi görebilir ve birini kaldırabilirsiniz (en az bir yöntem kalmalıdır). bycoda'nın erişimini Google hesap izinlerinizden veya GitHub'da Ayarlar, Uygulamalar bölümünden de iptal edebilirsiniz. bycoda hesabınızı silmek bizim taraftaki bağlantıyı kaldırır.

## Cihazlarınız

Giriş yaptığınız her cihaz için cihaz adı, işletim sistemi ve sürümü, uygulama sürümü, yayın kanalı, push bildirimlerini açtıysanız push token'ı, cihazın ilk kayıt zamanı ve son görülme zamanı saklanır. Bu listeyi uygulamada ve hesap portalında görebilir, bir cihazın oturumunu uzaktan kapatabilirsiniz.

## Etkin süre

bycoda'yı ne kadar kullandığınızı göstermek için uygulama, her günün hangi dakikalarında etkin kullanıldığını cihazınızda kaydeder. Giriş yaptıysanız bu, cihaz başına günde tek kompakt kayıt olarak yüklenir: günün her dakikası için bir açık/kapalı değeri içeren 1.440 değerlik harita, tarih ve saat dilimi. Ne yaptığınıza dair hiçbir bilgi içermez. Ekranda ne olduğu, hangi proje veya oturumun açık olduğu ve ne yazdığınız asla kaydedilmez. Hesap olmadan etkin süre cihazınızda kalır.

Bu kayıtları toplamlarınızı (gün, hafta, ay, yıl) göstermek için, toplu olarak da bycoda'nın ne kadar kullanıldığını anlamak ve kapasite planlamak için kullanırız. Personelin tekil kayıtlara erişimi hizmeti işletmek ve desteklemekle sınırlıdır.

## Hesabı devre dışı bırakma ve yeniden etkinleştirme

Hesabınızı silmek yerine uygulamadan veya portaldan devre dışı bırakabilirsiniz. Devre dışı bırakma verilerinizi korur, tüm cihazlarınızın oturumunu kapatır, bildirimleri ve yüklemeleri durdurur. İsteğe bağlı bir neden ekleyebilirsiniz; bu hesapla birlikte saklanır. Yeniden etkinleştirme hesabı geri getirir. Devre dışı bırakma silme değildir: aşağıdaki saklama kuralları etkin bir hesap gibi geçerlidir ve hesabın silinmesini dilediğiniz zaman isteyebilirsiniz.

## Destek talepleri

Portaldan bir destek talebi gönderirseniz konusunu, mesajını ve kategorisini, durumunu, tarihini ve personelimizin eklediği yanıtları ve iç notları saklarız. Personel bunu yalnızca size yanıt vermek için kullanır. Talep hesabınız var olduğu sürece saklanır ve hesapla birlikte silinir. Talebe parola, kod veya başka sırlar yazmayın.

## Geri bildirim

Uygulamadan geri bildirim gönderirseniz türünü (fikir, sorun, beğeni, diğer), mesajınızı, isteğe bağlı 1–5 puanınızı ve tarihini saklarız. Yalnızca "Uygulama sürümünü ve sistemi ekle" kutusunu işaretlerseniz uygulama sürümünü, işletim sistemini ve sürümünü, yayın kanalını da saklarız. Giriş yaptıysanız geri bildirim hesabınıza bağlanır ve hesapla birlikte silinir. Hesapsız gönderilen geri bildirim hesap, cihaz, kurulum kimliği veya IP adresi olmadan saklanır. Personel geri bildirimi yalnızca bycoda'yı geliştirmek için kullanır. Geri bildirim 365 gün sonra silinir. Geri bildirime parola, kod veya başka sırlar yazmayın.

## Denetim kayıtları

Hizmetin güvenli ve hesap verebilir kalması için önemli hesap olaylarını ve personelin hesaplar üzerinde yaptığı her işlemi kaydederiz (kim, ne, ne zaman, belirtilen gerekçe ve IP adresinin özetlenmiş hâli). Hesabınız silindikten sonra bu kayıtlar saklanır; yalnızca takma adlı bir iç tanımlayıcıyla ilişkilidir, adınız veya e-posta adresinizle değil. Kayıttaki özetlenmiş IP adresi 180 gün sonra silinir.

## İsteğe bağlı anonim istatistik

Anonim istatistik isteğe bağlıdır ve hesaplı ya da hesapsız varsayılan olarak kapalıdır. Uygulama size bir kez sorar (ilk kurulumda ya da daha önce hiç sorulmadıysanız uygulama içinde bir kez) ve yalnız paylaşmayı seçerseniz gönderim yapar; seçiminizi Ayarlar'dan istediğiniz zaman değiştirebilirsiniz. Açıkken uygulama günde en fazla bir küçük sinyal gönderir: rastgele kurulum kimliği, uygulama sürümü, işletim sistemi, yayın kanalı ve tarih. Kimlik donanımınızdan, adınızdan veya e-postanızdan türetilmez ve hiçbir hesapla ilişkilendirilmez. Ayarı kapatmak sinyali durdurur.

## Hesap portalı istatistikleri

Hesap portalı (account.bycoda.codes) çerezsiz bir araç olan Cloudflare Web Analytics kullanır. Çerez, yerel depolama veya parmak izi kullanmaz; yalnızca toplu sayfa görüntülemeleri ve sayfa performansı ölçümlerini kaydeder. Cloudflare alan adlarımıza gelen trafiği ağ sağlayıcımız olarak zaten işler (aşağıdaki hizmet sağlayıcılar listesine bakın). Yönetim alanı bunu yüklemez. Masaüstü uygulaması, mobil uygulama ve bycoda.codes web sitesi Cloudflare Web Analytics kullanmaz.

## Bildirimler

Push bildirimlerini açarsanız mobil push token'ı, bildirimi Apple veya Google üzerinden cihazınıza ileten Expo'nun push servisine gönderilir. Gönderdiğimiz e-postalar (örneğin hesap silme onayı veya abone olduğunuz özet) işlemsel e-posta sağlayıcısı Resend üzerinden gider; Resend kullanılamazsa kendi posta sunucumuz (Hostinger sunucumuzda çalışan Mailu) üzerinden gönderilir. Uygulama içi bildirim akışınız öğeleri 90 gün tutar. Giriş kodları ve doğrulama e-postaları Clerk tarafından gönderilir. Bildirimler genel bir metin ve bağlantı içerir; oturum içeriği içermez. Özet e-postaları yalnızca abone olursanız gönderilir ve her birinde abonelikten çıkma bağlantısı vardır. Kanalları ve kategorileri uygulamadan veya portaldan değiştirebilirsiniz.

## Hizmet sağlayıcılar (alıcılar)

Hesap hizmetini işletmek için aşağıdaki sağlayıcıları kullanırız. Kendi politikalarıyla bağımsız sorumlu olarak çalıştıkları durumlar dışında verileri bizim talimatlarımızla işlerler. Gizlilik politikalarının bağlantıları "Üçüncü taraflar ve veri kontrolleri" metnindedir. Kişisel verileri satmaz ve reklam için paylaşmayız.

- Clerk (Amerika Birleşik Devletleri): kimlik, giriş, doğrulama e-postaları ve oturumlar. Veri işleyen.
- Cloudflare (ABD, küresel ağ): DNS, ağ, güvenlik, trafik koruması ve yalnızca hesap portalında toplu web analitiği. Veri işleyen.
- Hostinger (Avrupa Birliği'nde bulunan sanal sunucu): hesap hizmetinin, veritabanının ve kendi posta sunucumuzun barındırılması. Veri işleyen.
- Expo (ABD): Apple veya Google üzerinden iletilen mobil push bildirimlerinin gönderimi. Veri işleyen.
- Resend (ABD merkezli şirket; AB gönderim bölgesini kullanırız): işlemsel ve abonelikli özet e-postalarının iletimi (ilk tercih). Veri işleyen.
- Kendi posta sunucumuz (AB'deki Hostinger sunucumuzda Mailu): Resend kullanılamadığında aynı e-postaların yedek iletimi ve bycoda.codes adreslerimize gelen postanın alınması.
- Seçtiğiniz giriş sağlayıcıları (Google, GitHub ve sunuluyorsa Apple veya Facebook; ABD): kendi politikalarıyla sizi doğrularlar.
- Yetkili kamu kurumları, mahkemeler veya diğer üçüncü kişiler, yalnızca kanunun gerektirdiği hâllerde.

Sağlayıcılar eklenebilir veya değiştirilebilir; bu olduğunda bu sayfa güncellenir. Bakımcı, hizmeti işletmek ve desteklemek için verilere erişebilir.

## Yurt dışına aktarım

Veritabanımız ve sunucularımız Avrupa Birliği'ndedir. Yukarıdaki sağlayıcıların bir kısmı (Clerk, Cloudflare, Expo, Resend ve giriş sağlayıcıları) ABD'de ve başka ülkelerde yerleşik veya oradan verilere erişebilen şirketlerdir; bu nedenle kişisel veriler Türkiye, Avrupa Ekonomik Alanı ve ülkeniz dışında da işlenebilir.

- KVKK madde 9 (2024'te 7499 sayılı Kanunla değişen hâliyle) uyarınca bu aktarımlar, sağlayıcıların sunduğu standart sözleşme ve veri işleme şartlarına ve bu politikada açıklanan güvencelere dayanır. Hiçbir sağlayıcı için yeterlilik kararına dayanmıyoruz. Aktarım arızi ve tekrarlanmayan nitelikteyse açık rızanıza veya madde 9'daki başka bir istisnaya da dayanabilir.
- GDPR uyarınca Avrupa Ekonomik Alanı dışına aktarımlar, sağlayıcıların standart sözleşme hükümlerine veya geçerli bir yeterlilik kararına (örneğin sağlayıcı sertifikalıysa AB-ABD Veri Gizliliği Çerçevesi) dayanır.
- Güvenceler hakkında bilgi için [info@bycoda.codes](mailto:info@bycoda.codes) adresine yazabilirsiniz.

## Hesap saklama, dışa aktarma ve silme

- Hesap verileri (profil, cihazlar, bildirim ayarları) hesap var olduğu sürece saklanır.
- Giriş olayları: girişlerin ve cihaz kayıtlarının ülkesi (IP adresi olmadan) 180 gün saklanır; portal son 90 günü Güvenlik etkinliği olarak gösterir.
- Bildirim akışı öğeleri 90 gün saklanır.
- Destek talepleri hesap var olduğu sürece saklanır ve hesapla birlikte silinir.
- Geri bildirim 365 gün sonra, giriş yapılarak gönderildiyse hesapla birlikte de silinir.
- Denetim kayıtları hesap silindikten sonra takma adlı bir iç tanımlayıcıyla saklanır; içindeki özetlenmiş IP adresi 180 gün sonra silinir.
- Devre dışı bırakılmış hesap, yeniden etkinleştirene veya silene kadar verilerini aynı kurallarla korur.
- Etkin süre kayıtları geçmişiniz görünür kalsın diye hesap var olduğu sürece saklanır.
- Sunucu günlükleri 14 ila 30 gün saklanır. Oturum içeriği ve kişisel veri içermez; güvenlik ve sorun giderme için gereken teknik tanımlayıcılar bulunabilir.
- Anonim istatistik sinyalleri bir kişiyle ilişkilendirilmez ve 400 gün saklanır.
- Yedekler: veritabanı yedekleri, silinen veriler 30 gün içinde yedeklerden de çıkacak şekilde döndürülür (son 30 günlük yedek tutulur).
- Dışa aktarma: hesap verilerinizin (profil, cihazlar, etkin süre kayıtları, bildirim tercihleri) makine tarafından okunabilir dökümünü uygulamadan veya portaldan isteyebilirsiniz. Dışa aktarma dosyası 7 gün erişilebilir kalır, sonra silinir.
- Silme: hesabınızın silinmesini uygulamadan veya portaldan isteyebilirsiniz. Bu süre içinde iptal etmezseniz verileriniz istekten 14 gün sonra silinir. Sonrasında hesap verileriniz, cihazlarınız ve etkin süre kayıtlarınız kalıcı olarak silinir, push token'ları kaldırılır. Varsa yalnızca kanunen saklanması gereken kayıtları ve yukarıda açıklanan takma adlı denetim kayıtlarını tutarız.
- Bir cihazı kaldırmak push token'ını siler ve yüklemelerini durdurur.

## Amaçlar ve hukuki sebepler

- Hesabınızı oluşturmak ve işletmek, giriş, cihazlar, etkin süre, destek talepleri ve istediğiniz bildirimler: istediğiniz hizmetin ifası (GDPR m. 6/1-b; KVKK m. 5/2-c).
- Push bildirimleri, özet e-postaları ve isteğe bağlı anonim istatistik: rızanız; uygulamadan veya portaldan dilediğiniz zaman, önceki işlemeyi etkilemeden geri çekebilirsiniz (GDPR m. 6/1-a; KVKK m. 5/1, açık rıza).
- Güvenlik, kötüye kullanımı önleme, denetim kayıtları, giriş ülkesi, sunucu günlükleri, güvenilirlik, toplu kullanım istatistikleri ve kapasite planlaması, web sitesi ve portal istatistikleri, geri bildirim: haklarınızı aşmayan meşru menfaatlerimiz (GDPR m. 6/1-f; KVKK m. 5/2-f).
- Hukuki yükümlülükler ile bir hakkın tesisi, kullanılması veya korunması (GDPR m. 6/1-c ve f; KVKK m. 5/2-a, ç ve e).

Hesap oluşturmak için e-posta adresi vermek gereklidir; gönderdiğiniz diğer her şey isteğe bağlıdır. Sizinle ilgili yalnızca otomatik işlemeye dayalı kararlar vermeyiz.

## Haklarınız

GDPR uyarınca verilerinize erişim (m. 15), düzeltme (m. 16), silme (m. 17), kısıtlama (m. 18), bu işlemlerin alıcılara bildirilmesi (m. 19), taşınabilirlik (m. 20) ve itiraz (m. 21) talep edebilir; rızanızı dilediğiniz zaman geri çekebilir (m. 7) ve yalnızca otomatik işlemeye dayalı kararlara tabi tutulmama hakkına sahip olursunuz (m. 22). KVKK madde 11 kapsamındaki haklarınız aşağıdaki KVKK aydınlatma metninde sayılmıştır. Erişim, dışa aktarma ve silme uygulamada ve portalda da bulunur.

Başvuru: talebinizi [info@bycoda.codes](mailto:info@bycoda.codes) adresine e-postayla iletin. Verilerinizi korumak için kimliğinizi doğrulamanızı isteyebiliriz; örneğin hesabınızdaki e-posta adresinden yazmanız yeterlidir. GDPR kapsamında bir ay içinde, KVKK kapsamında en geç 30 gün içinde ve ücretsiz yanıt veririz; yanıtın on sayfayı aşan yazılı bir cevap gerektirmesi hâlinde Kişisel Verileri Koruma Kurulu tarifesindeki ücret alınabilir.

Şikâyet: Türkiye'deyseniz bize başvurduktan sonra Kişisel Verileri Koruma Kurulu'na (kvkk.gov.tr) şikâyet edebilirsiniz. AB veya AEA'daysanız yerel veri koruma denetim otoritenize şikâyet edebilirsiniz. Önce bize yazabilirsiniz; konuyu çözmeye çalışırız.

## KVKK aydınlatma metni

Bu bölüm 6698 sayılı Kişisel Verilerin Korunması Kanunu'nun (KVKK) 10. maddesine ve Aydınlatma Yükümlülüğünün Yerine Getirilmesinde Uyulacak Usul ve Esaslar Hakkında Tebliğ'e göre hazırlanmıştır. Türkçe metin bycoda.codes/kvkk adresinde ve uygulamanın Türkçe dilinde yayımlanır.

- Veri sorumlusu: bycoda'yı bağımsız olarak geliştiren ve sürdüren geliştirici (GitHub: [bahadryalcn](https://github.com/bahadryalcn)). İletişim: [info@bycoda.codes](mailto:info@bycoda.codes). Resmi başvurular için ad-soyad ve posta adresi bu adrese yapılacak talep üzerine bildirilir.
- İşlenen veriler: kimlik ve iletişim verileri (ad, e-posta, profil resmi, giriş sağlayıcısındaki hesap kimliği), cihaz ve teknik veriler (cihaz adı, işletim sistemi, uygulama sürümü, push token'ı, giriş ülkesi), kullanım verileri (etkin dakika kayıtları, anonim istatistik), destek talepleri, geri bildirim ve işlem güvenliği verileri (günlükler, denetim kayıtları). Özel nitelikli kişisel veri istenmez.
- Amaçlar: hesabınızı oluşturmak ve işletmek, giriş yapmanızı sağlamak, cihazları yönetmek, etkin sürenizi göstermek, istediğiniz bildirimleri göndermek, destek, güvenlik ve kötüye kullanımı önleme, hizmet planlaması ve hukuki yükümlülükler.
- Hukuki sebepler (madde 5): sözleşmenin ifası, veri sorumlusunun meşru menfaati, hukuki yükümlülük, bir hakkın tesisi, kullanılması veya korunması ve isteğe bağlı özellikler (anonim istatistik, push ve özet bildirimleri) için dilediğiniz zaman geri alabileceğiniz açık rızanız.
- Toplama yöntemi: uygulama, portal, web sitesi ve seçtiğiniz giriş sağlayıcıları üzerinden elektronik ortamda.
- Alıcılar: yukarıda sayılan hizmet sağlayıcılar ve kanunen gerektiğinde yetkili kamu kurumları.
- Yurt dışına aktarım: kişisel veriler yukarıda sayılan, bir kısmı yurt dışında işlem yapan sağlayıcılara, KVKK madde 9 uyarınca sağlayıcıların standart sözleşme şartlarına veya arızi aktarımlarda açık rızanıza dayanarak aktarılır.
- Haklarınız (madde 11): kişisel verilerinizin işlenip işlenmediğini öğrenme ve bilgi talep etme; işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme; yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme; eksik veya yanlış işlenmişse düzeltilmesini isteme; silinmesini veya yok edilmesini isteme; bu işlemlerin aktarılan üçüncü kişilere bildirilmesini isteme; yalnızca otomatik analizle aleyhinize bir sonuç çıkmasına itiraz etme; kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde zararın giderilmesini talep etme.
- Başvuru yöntemi: adınızı, imzanızı, kimlik bilgilerinizi, tebligat adresinizi ve talebinizin konusunu içeren yazılı talebinizi hesabınıza kayıtlı e-posta adresinden [info@bycoda.codes](mailto:info@bycoda.codes) adresine; ya da Başvuru Usul ve Esasları Hakkında Tebliğ'in izin verdiği şekilde kayıtlı elektronik posta (KEP), güvenli elektronik imza, noter veya posta yoluyla (posta adresi talep üzerine bildirilir) iletin. En geç 30 gün içinde yanıtlarız. Yanıtı yetersiz bulursanız veya süresinde yanıt alamazsanız, yanıtı öğrendiğiniz tarihten itibaren 30 gün ve her hâlde başvuru tarihinden itibaren 60 gün içinde Kişisel Verileri Koruma Kurulu'na şikâyet edebilirsiniz.

## Çocuklar

bycoda ve bycoda hesabı 16 yaşın altındaki çocuklara yönelik değildir ve bilerek onların kişisel verilerini toplamayız. 18 yaşından küçükseniz hesap oluşturmak için ebeveyninizin veya yasal vasinizin izni gerekir. 16 yaşın altındaki bir kişiye ait hesap tuttuğumuzu öğrenirsek hesabı sileriz. Bunun gerçekleştiğini düşünen bir ebeveyn veya vasi [info@bycoda.codes](mailto:info@bycoda.codes) adresine yazabilir.

## Güvenlik

Hesap verilerini riske uygun önlemlerle koruruz: uygulamalar, portal, web sitesi ve sunucularımız arasında şifreli bağlantılar (HTTPS); parola yok (Clerk üzerinden Google, GitHub veya tek kullanımlık kodla giriş); işletim sisteminin güvenli kimlik bilgisi deposunda tutulan giriş token'ları; yönetim alanına yalnızca adı belli personelin bir erişim geçidinin arkasından erişmesi ve erişimin denetim kayıtlarına yazılması; IP adreslerinin veritabanımızda saklanmaması ve denetim kayıtlarında özetlenmesi; istek gövdelerini, token'ları, e-posta adreslerini ve ham IP adreslerini içermeyen sunucu günlükleri; düzenli veritabanı yedekleri. Hiçbir sistem kusursuz değildir. Haklarınızı riske atan bir ihlal olursa yetkili otoriteyi ve etkilenen kişileri kanunun gerektirdiği şekilde bilgilendiririz. Güvenlik açıklarını [info@bycoda.codes](mailto:info@bycoda.codes) adresine özel olarak bildirin.

## Çerezler ve yerel depolama

bycoda.codes web sitesi çerez kullanmaz ve çerezsiz Umami istatistikleri kullanır. Hesap portalı yalnızca Clerk'in oturumunuzu açık tutmak ve dil ile tema tercihinizi hatırlamak için ihtiyaç duyduğu çerez ve depolamayı kullanır; ayrıca çerez bırakmayan Cloudflare Web Analytics kullanır. Masaüstü ve mobil uygulamalar tercihleri ve taslakları cihazınızdaki yerel depolamada, giriş token'larını güvenli kimlik bilgisi deposunda tutar. Reklam veya siteler arası takip çerezleri kullanmayız.

## Cihazlarınızdaki veriler

Uygulama verdiğiniz izinler kapsamında dosya ve klasörleri okur. Ayarları, proje yollarını, konuşmaları, oturum durumunu, notları, kullanım sayaçlarını, entegrasyon bilgilerini ve tanılama bilgilerini yerel olarak saklar. Ajan araçları izinleri kapsamında dosya okuyabilir, değiştirebilir ve komut çalıştırabilir. Sağlayıcı CLI'ları kendi geçmiş, günlük ve kimlik doğrulama dosyalarını da tutabilir.

Geçmiş, uygulama veri klasöründeki bycoda.db gibi yerel depolarda tutulur; tercihler webview yerel depolamasında da bulunabilir. Bağlı host'ların kendi veritabanları ve günlükleri vardır. Kimlik bilgileri ilgili entegrasyon, sağlayıcı CLI'ı veya yerel kimlik bilgisi deposunda yönetilir. Sosyal entegrasyon token'ları işletim sisteminin koruduğu bir anahtarla yerel olarak şifrelenmiş kasada saklanır. Bu, bütün yerel dosya, günlük ve veritabanlarının şifrelendiği garantisi değildir.

## Ağ erişimi ve üçüncü taraflar

Yapay zekâ ajanları ve sağlayıcı CLI'ları istemleri, seçilen bağlamı, ekleri, kodu ve araç sonuçlarını oturum için yapılandırılmış sağlayıcıya veya uç noktaya gönderir. Saklama, eğitim, telemetri, ücretlendirme ve gizlilik kurallarını bycoda değil, ilgili sağlayıcı ve hesap ayarlarınız belirler.

Git, gelen kutusu, MCP, tarayıcı ve sosyal özellikler işlerini yapmak için gerekli verileri yapılandırdığınız servislerle paylaşır. İzinlere bağlı olarak depo bilgileri, işler, mesajlar, hesap kimlikleri, gönderiler, yorumlar ve medya işlenebilir. Bağlı servisler arka planda sorgulanabilir; yetkilendirilmiş zamanlanmış görevler daha sonra çalışabilir. Uzak erişim ve eşitleme, çalışma alanı/oturum verilerini eşleştirdiğiniz cihazlarla veya host'larla paylaşır. Bu host'lar bakımcının değil, sizin veya host işletmecisinin kontrolündedir.

Güncellemelerin etkin olduğu sürümlerde kontrol ve indirmeler GitHub sürüm altyapısına bağlanır. bycoda hesabı kullanıyorsanız uygulama bycoda hesap hizmetine de bağlanır. Kayıt dizinlerini keşfetme, kurulum, dış bağlantılar ve uzak görseller ilgili servislere bağlanabilir. Bu servisler IP adresiniz ve istek bilgileri gibi olağan bağlantı verilerini alır ve kendi politikalarını uygular. Paketlenmiş politikaları okumak ağ isteği gerektirmez. Sağlayıcı bağlantıları üçüncü taraflar ve veri kontrolleri metninde bulunur.

## İsteğe bağlı sosyal ve YouTube özellikleri

Sosyal hesap bağlantısı, verdiğiniz izinler kapsamında desteklenen API işlemlerini sağlar: hesap/kanal bilgileri, yorum veya mesaj okuma; medya yükleme, gönderi yayımlama veya yanıt verme. Bu veriler cihazınızda veya seçtiğiniz host'ta tutulur ve platformla paylaşılır. Analitik veya reklam amacıyla bakımcıya gönderilmez.

YouTube entegrasyonu YouTube API Hizmetlerini kullanır. Google'ın işlemesine [Google Gizlilik Politikası](https://policies.google.com/privacy) uygulanır. Yetkilendirmeyi [Google hesap izinlerinden](https://security.google.com/settings/security/permissions) iptal edebilirsiniz. YouTube özellikleri [YouTube Hizmet Şartlarına](https://www.youtube.com/t/terms) da tabidir.


## İsteğe bağlı e-posta ve Slack mesajlaşması

Bir e-posta hesabı (Google ile giriş veya uygulama şifresiyle Gmail ya da herhangi bir IMAP/SMTP sunucusu) veya bir Slack çalışma alanı bağladığınızda bycoda konuşmalarınızı listeler, mesajları Mesajlar görünümünde gösterir ve yalnızca Gönder'e bastığınızda yanıt gönderir. Giriş tarayıcınızda yapılır; oluşan token'lar veya şifreler cihazınızdaki yerel uygulama verilerinde saklanır ve arayüzde hiç gösterilmez. Mesajlar, kişiler ve token'lar doğrudan cihazınız ile Google, Slack veya e-posta sunucunuz arasında aktarılır. Bakımcıya veya herhangi bir bycoda sunucusuna, bycoda hesabı kullandığınızda bile gönderilmez. bycoda e-postaları okundu olarak işaretlemez.

bycoda'nın Google API'lerinden aldığı bilgileri kullanması ve aktarması, Sınırlı Kullanım (Limited Use) şartları dahil [Google API Hizmetleri Kullanıcı Verileri Politikası](https://developers.google.com/terms/api-services-user-data-policy)'na uygundur. Gmail verileri yalnızca istediğiniz Mesajlar özelliğini sağlamak için kullanılır; reklam için kullanılmaz, satılmaz veya başkalarına aktarılmaz, insanlar tarafından okunmaz ve yapay zekâ modellerini eğitmek için kullanılmaz.

Slack girişi \`https://bycoda.codes/oauth/slack/\` üzerinden döner. Bu statik sayfa yalnızca tek kullanımlık giriş kodunu cihazınızdaki bycoda uygulamasına iletir. Sayfa hiçbir şey saklamaz ve kod, yalnızca uygulamada tutulan bir gizli değer olmadan kullanılamaz.

Bir hesabı Ayarlar > Entegrasyonlar'dan kaldırdığınızda saklanan kimlik bilgileri cihazınızdan silinir. Erişimi [Google hesap izinleri](https://myaccount.google.com/permissions) sayfasından veya Slack çalışma alanınızın uygulama ayarlarından da kaldırabilirsiniz.

## Cihazlarınızda saklama, silme ve kontrol

Yerel veriler, mevcut kontrollerle veya ilgili uygulama/sağlayıcı/host depolarını kaldırarak silene kadar kalır. Bütün veriler için ortak bir otomatik son kullanma süresi yoktur. Arşivlemek veya gizlemek silmek değildir. Çalışma alanı kaydını kaldırmak proje dosyalarını, sağlayıcı geçmişini, yedekleri veya uzak kopyaları mutlaka silmez. Uygulamayı kaldırmak veri klasörünü bırakabilir.

Kullanmadığınız hesapların bağlantısını kesin, zamanlanmış/arka plan işlerini durdurun, sağlayıcıdan erişimi iptal edin ve gereksiz verileri her cihaz ve host'tan kaldırın. Sosyal hesap bağlantısını kesmek yerel token'ı siler ve hesabı duraklatır; hesap bilgileri ve önceden saklanmış sosyal kayıtlar kalır. Yayımlanmış gönderiler veya platformun tuttuğu veriler silinmez. Tam yerel sıfırlama için uygulama ve host'u durdurun, tutmak istediğiniz verileri yedekleyin ve uygulama verileriyle ilgili sağlayıcı depolarını kaldırın. Bu işlem yıkıcıdır ve birden fazla hesabı etkiler. Platformdaki içerikleri platformun kendi kontrolleriyle silin.

Bakımcı yerel çalışma alanınızı inceleyemez veya uzaktan silemez. Yardım ya da bakımcıya gönüllü gönderdiğiniz bilgilerle ilgili talepler için yukarıdaki adrese yazın; bycoda hesabı verileri yukarıdaki hesap saklama bölümünde açıklanır. Bağlı sağlayıcıların kayıtları için ilgili sağlayıcıya da başvurun. Uygulanabilir veri koruma hakları; erişim, düzeltme, silme, itiraz ve yetkili makama şikâyet hakları bu politikayla kaldırılmaz.

## Gönüllü iletişim ve değişiklikler

E-posta, issue, tanılama dosyası veya destek materyali gönderirseniz bakımcı seçerek paylaştığınız bilgileri alır ve talebi yanıtlamak için kullanır. E-posta ve GitHub kendi politikalarıyla çalışır. Yazışmalar yalnızca talebi ele almak ve gerekli güvenlik/proje kayıtlarını tutmak için gereken süre boyunca saklanır. Gereken en az bilgiyi gönderin, günlükleri paylaşmadan önce sırları çıkarın.

Bu politikayı, örneğin sağlayıcılar veya özellikler değiştiğinde güncelleyebiliriz. Değişiklikler üstte tarihlendirilir ve depoda, bycoda.codes'ta ve sonraki uygulama sürümlerinde yayımlanır; hesap sahiplerini etkileyen önemli değişiklikleri ayrıca uygulamada veya portalda duyururuz. Bu metin bağlandığınız servislerin politikalarını değiştirmez.
`,
  terms: `# Kullanım koşulları

Son güncelleme: 9 Kasım 2026

## Yazılım ve lisans

bycoda, kurulu ajan araçları ve isteğe bağlı entegrasyonlar için bağımsız olarak sürdürülen açık kaynak masaüstü çalışma alanıdır. Deponun MIT lisansıyla sunulur. Bu koşullar kullanım açıklamasıdır; lisansın verdiği izinleri daraltmaz veya üçüncü taraf lisans bildirimlerinin yerini almaz. MIT lisansı uygulamada paketlenir ve depoda LICENSE dosyasında bulunur. Yazılım ücretsizdir.

## İşlemleriniz ve izinleriniz

Bağlanacak projeleri, hesapları, sağlayıcıları, araçları, host'ları ve verilecek izin/onayları siz seçersiniz. Yalnızca yetkiniz olan veri ve servislere erişin. Ajan ve araçlar izinleri kapsamında dosya değiştirebilir, komut çalıştırabilir, bağlam aktarabilir ve yayımlama dahil dış işlemler yapabilir. Zamanlanmış ve arka plan işlemleri her adımı izlemeden devam edebilir. Yapılandırmayı ve sonuçları inceleyin, yedek alın ve kimlik bilgilerinizi koruyun.

Yapay zekâ çıktıları yanlış, eksik veya güvensiz olabilir. Üretilen kod ve içeriği kullanmadan veya üretim ortamına almadan önce incelemek sizin sorumluluğunuzdadır. bycoda hukuki, mali veya başka bir mesleki danışmanlık sunmaz.

## Uygunluk

bycoda ve bycoda hesabı 16 yaşın altındaki çocuklara yönelik değildir. 18 yaşından küçükseniz hesap oluşturmak için ebeveyninizin veya yasal vasinizin izni gerekir. 16 yaşın altındaki kişilere ait hesapları öğrendiğimizde sileriz.

## İsteğe bağlı bycoda hesabı

bycoda hesabı isteğe bağlı ve ücretsizdir; bireysel kullanım için ödeme veya abonelik yoktur. Hesap olmadan uygulama eskisi gibi yerel çalışır. Google, GitHub veya e-posta ile tek kullanımlık kodla (sunuluyorsa Apple veya Facebook ile) giriş yapabilirsiniz. Hesap oluşturursanız doğru bilgi verin, giriş yöntemlerinizi güvende tutun ve kullanmadığınız cihazların oturumunu kapatın. Hesabınızdaki işlemlerden siz sorumlusunuz. Hesabınızı istediğiniz zaman uygulamadan veya portaldan devre dışı bırakabilir ya da silebilirsiniz; silme, gizlilik politikasında açıklandığı gibi, iptal etmezseniz istekten 14 gün sonra gerçekleşir.

## Kabul edilebilir kullanım

bycoda hesap hizmetini veya web sitesini; hukuka veya başkalarının haklarına aykırı davranmak, hizmetin güvenliğine saldırmak, onu yoklamak, aşırı yüklemek veya aşmak, size ait olmayan hesap ya da verilere erişmek, hesap oluşturmayı otomatikleştirmek veya bildirim, geri bildirim ya da destek kanallarımızdan istenmeyen ileti göndermek, zararlı yazılım veya hukuka aykırı içerik yüklemek ya da personeli veya başkalarını rahatsız etmek için kullanmayın. Kimliğinizi yanlış beyan etmeyin ve başkasını taklit etmeyin.

## Askıya alma ve sonlandırma

Bu koşulları ihlal eden, hizmeti kötüye kullanan veya güvenliğini tehdit eden bir hesabı ya da kanun gerektirdiğinde herhangi bir hesabı, mümkün ve güvenli olduğunda bildirimle sınırlayabilir, askıya alabilir veya kapatabiliriz. Hesap özelliklerini ya da hesap hizmetinin kendisini, mümkünse makul bir bildirimle değiştirebilir veya durdurabiliriz. bycoda'yı kullanmayı bırakabilir ve hesabınızı istediğiniz zaman kapatabilirsiniz. Hesabın kapatılması yazılımın MIT lisansını etkilemez; kapatmadan sonra gizlilik politikasındaki saklama kuralları geçerli olur.

## Üçüncü taraf servisler

Sağlayıcı hesapları, API anahtarları, abonelikler, kotalar, ücretler ve koşullar sizinle ilgili servis arasındadır. Google veya GitHub ile giriş yaptığınızda bu kısım için onların koşulları ve gizlilik politikaları geçerlidir. Bakımcı bu servisleri işletmez, kullanılabilirliğini veya çıktılarını garanti etmez. Sağlayıcı API/izin değişiklikleri özellikleri değiştirebilir veya çalışmasını durdurabilir. YouTube API özelliklerini kullanırken [YouTube Hizmet Şartları](https://www.youtube.com/t/terms) geçerlidir. Diğer platformların koşulları da uygulanır.

## Garanti verilmemesi ve sorumluluk sınırı

MIT lisansında belirtildiği gibi yazılım OLDUĞU GİBİ sunulur; ticarete elverişlilik, belirli amaca uygunluk ve hak ihlal etmeme dahil açık veya örtülü hiçbir garanti verilmez. Bakımcı kesintisiz çalışma, hatasız sonuç, veri kurtarma veya belirli bir sonuç vaat etmez. Hesap hizmeti ücretsiz ve mevcut olduğu şekliyle sunulur.

Uygulanabilir hukukun izin verdiği en geniş ölçüde ve MIT lisansıyla uyumlu olarak; yazarlar, telif hakkı sahipleri ve bakımcı yazılımdan veya kullanımından doğan talepler, zararlar ve diğer sorumlulukları kabul etmez. Buna veri kaybı, ajan işlemleri, üretilen içerik, servis ücretleri ve üçüncü taraf arızaları dahildir. Hukuken kaldırılamayacak sorumluluklar (örneğin kanunun sınırlamaya izin vermediği kasıt veya ağır kusur sorumluluğu) ile zorunlu tüketici ve veri koruma hakları bu metinle kaldırılmaz.

## Uygulanacak hukuk ve uyuşmazlıklar

Bu koşullara Türkiye Cumhuriyeti hukuku uygulanır. Hesap hizmetine ilişkin uyuşmazlıklarda bakımcının ikametgâhının bulunduğu yerin mahkemeleri ve icra daireleri yetkilidir; sizin başka mahkeme veya kurumlara başvurmanızı sağlayan emredici kurallar, veri koruma haklarınız ve tüketiciyseniz tüketici hakem heyetleri ile mahkemelerine başvuru hakkınız saklıdır.

## Gizlilik, güvenlik ve iletişim

Gizlilik politikası yerel depolamayı, bycoda hesabında tutulan verileri ve bağlı servisleri açıklar. Güvenlik açıklarını özel kanaldan bildirin; sırları veya istismar ayrıntılarını açık issue'larda yayımlamayın. Gizlilik, güvenlik ve diğer sorular için [info@bycoda.codes](mailto:info@bycoda.codes) adresine yazın veya [bakımcının GitHub profilini](https://github.com/bahadryalcn) ziyaret edin.

## Değişiklikler

Bu koşulları güncelleyebiliriz. Değişiklikler üstte tarihlendirilir, depoda yayımlanır ve sonraki uygulama sürümlerine eklenir; hesap sahiplerini etkileyen önemli değişiklikleri ayrıca uygulamada veya portalda duyururuz. Değişiklikten sonra hesabı kullanmaya devam etmek güncel koşulları kabul ettiğiniz anlamına gelir; kabul etmiyorsanız hesabınızı kapatabilirsiniz. Bu koşullar sertifikasyon, mevzuata uygunluk, sağlayıcı onayı veya hizmet seviyesi anlaşması iddiası içermez.`,
  thirdParty: `# Üçüncü taraflar ve veri kontrolleri

Son güncelleme: 9 Kasım 2026

## Bağlantıları siz seçersiniz

Bakımcı çalışma alanı içeriğiniz için merkezi veri deposu işletmez. İsteğe bağlı bir bycoda hesabı oluşturursanız sınırlı hesap, cihaz ve etkin süre verileri gizlilik politikasında açıklandığı gibi, sonraki bölümdeki sağlayıcılarla tutulur. Bağlı servisler özellikleri çalıştığında veri alır ve kendi kurallarını uygular. Kullandığınız sağlayıcı, CLI, MCP sunucusu, özel uç nokta veya kendi sunucunuzdaki servisin gizlilik ve hesap ayarlarını inceleyin; bu liste tüm servisleri kapsamaz.

## bycoda hesap hizmeti sağlayıcıları

Yalnızca bycoda hesabı oluşturursanız (veya bycoda web sitesini kullanırsanız) kullanılır. Sunucularımız Avrupa Birliği'ndedir; aşağıdaki sağlayıcıların bir kısmı ABD şirketidir, bu nedenle veriler standart sözleşme şartlarına dayanılarak Türkiye ve Avrupa Ekonomik Alanı dışında da işlenebilir (gizlilik politikasındaki "Yurt dışına aktarım" bölümüne bakın).

- Clerk (kimlik ve giriş): [gizlilik politikası](https://clerk.com/legal/privacy).
- Cloudflare (ağ ve güvenlik): [gizlilik politikası](https://www.cloudflare.com/privacypolicy/).
- Hostinger (sunucu barındırma, AB): [gizlilik politikası](https://www.hostinger.com/legal/privacy-policy).
- Expo (mobil push bildirimleri): [gizlilik politikası](https://expo.dev/privacy).
- Resend (işlemsel e-posta): [gizlilik politikası](https://resend.com/legal/privacy-policy).
- Kendi posta sunucumuz (Hostinger sunucumuzda Mailu): Resend kullanılamadığında aynı işlemsel e-postaların yedek iletimi ve bycoda.codes adreslerine gelen postanın alınması.
- Umami (web sitesi istatistikleri): bakımcı tarafından kendi sunucusunda işletilir, çerezsizdir; verileri üçüncü bir taraf almaz.
- Google veya GitHub ile giriş: sağlayıcıda kimliğinizi doğrularsınız; sağlayıcı adınızı, e-posta adresinizi, profil resminizi ve hesap kimliğinizi Clerk'e iletir, parolanızı asla iletmez. Kendi politikaları uyarınca hareket ederler ([Google](https://policies.google.com/privacy), [GitHub](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)). Bağlantıyı account.bycoda.codes adresinde Güvenlik altından veya sağlayıcının hesap ayarlarından kesebilirsiniz.
- Apple ile giriş (sunuluyorsa): [gizlilik politikası](https://www.apple.com/legal/privacy/). Facebook ile giriş (sunuluyorsa): aşağıdaki Meta bağlantısına bakın.

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

Bakımcıya gönüllü gönderilmiş bilgilerle ilgili talepler [info@bycoda.codes](mailto:info@bycoda.codes) adresine gönderilebilir. Bakımcı cihazlarınıza uzaktan erişemez; yerel verileri veya üçüncü taraf kayıtlarını sizin adınıza silemez.`,
};
