# Store listings (English / Telugu)

Screenshots come from `design/mockups/` (1080 × 1920). Category:
- consumer: Shopping (Play) / Food & Drink (App Store);
- merchant and rider: Business.
Every app is rated 18+. Before publishing, a native Telugu speaker on the city team checks the Telugu copy.

## Santha — consumer app (`apps/consumer`, icon: indigo)
**Short description (80).**
- en: The whole town, one app. Your neighbourhood shops, delivered in 30–45 minutes.
- te: ఊరంతా, ఒక్క యాప్‌లో. మీ పక్క దుకాణాలు, 30–45 నిమిషాల్లో డెలివరీ.

**Full description.**
- en: Santha brings Nellore's real neighbourhood shops, home kitchens and home businesses to your phone.
  Order groceries from the kirana you already trust, a hot meal from a home kitchen, or gifts from a
  home business, and get it in 30–45 minutes. There are no dark stores and no warehouses: every order
  is packed by a local shop.
  - Real local stores near you, with live opening hours
  - Delivered by Santha riders or the store's own staff, tracked live
  - Pay by UPI, card or cash on delivery
  - Report a missing or damaged item from the order screen and get a refund to your Santha wallet
  - In Telugu and English
- te: సంత నెల్లూరులోని నిజమైన పక్క దుకాణాలు, ఇంటి వంటశాలలు, ఇంటి వ్యాపారాలను మీ ఫోన్‌కు తెస్తుంది.
  మీరు నమ్మే కిరాణా నుండి సరుకులు, ఇంటి వంటశాల నుండి వేడి భోజనం, ఇంటి వ్యాపారాల నుండి బహుమతులు —
  30–45 నిమిషాల్లో. డార్క్ స్టోర్లు లేవు, గోదాములు లేవు: ప్రతి ఆర్డర్‌ను స్థానిక దుకాణమే ప్యాక్ చేస్తుంది.
  - మీ దగ్గరలోని నిజమైన దుకాణాలు, ప్రస్తుత పని వేళలతో
  - సంత రైడర్లు లేదా దుకాణం సిబ్బంది డెలివరీ, లైవ్ ట్రాకింగ్
  - UPI, కార్డ్ లేదా క్యాష్ ఆన్ డెలివరీ
  - తప్పిపోయిన లేదా పాడైన వస్తువును ఆర్డర్ స్క్రీన్ నుండే తెలియజేయండి, సంత వాలెట్‌కు రీఫండ్
  - తెలుగు మరియు ఇంగ్లీష్‌లో

## Santha Partner — merchant app (`apps/merchant`, icon: marigold)
**Short description.**
- en: Sell to your whole neighbourhood. Orders, catalogue and payouts in one app.
- te: మీ ఇరుగుపొరుగు అంతటికీ అమ్మండి. ఆర్డర్లు, కేటలాగ్, చెల్లింపులు ఒకే యాప్‌లో.

**Full description.**
- en: For Nellore's kiranas, home kitchens and home businesses.
  - List your items by scanning barcodes
  - Get loud order alerts
  - Deliver with a Santha rider or your own staff
  - Get paid the next day, with a clear statement: commission, GST, TCS and TDS on every line
  - Reply to customer reviews
- te: నెల్లూరు కిరాణాలు, ఇంటి వంటశాలలు, ఇంటి వ్యాపారాల కోసం.
  - బార్‌కోడ్ స్కాన్ చేసి వస్తువులు చేర్చండి
  - గట్టిగా మోగే ఆర్డర్ అలర్ట్‌లు
  - సంత రైడర్ లేదా మీ సిబ్బందితో డెలివరీ
  - మరుసటి రోజే చెల్లింపు, స్పష్టమైన స్టేట్‌మెంట్‌తో: ప్రతి లైన్‌పై కమీషన్, GST, TCS, TDS
  - కస్టమర్ సమీక్షలకు సమాధానం ఇవ్వండి

## Santha Rider — rider app (`apps/rider`, icon: light)
**Short description.**
- en: Deliver in your own town and earn every day. See the pay before you accept.
- te: మీ ఊరిలో డెలివరీ చేయండి, రోజూ సంపాదించండి. అంగీకరించే ముందే చెల్లింపు చూడండి.

**Full description.**
- en: Short trips inside your own neighbourhood.
  - Every offer shows the distance and the pay before you accept
  - Waiting at the store beyond 5 minutes is paid
  - Weekly payouts with a clear statement
  - Location is used only while you are online, to send you nearby orders and to show customers where their order is
- te: మీ ఇరుగుపొరుగులోనే చిన్న ట్రిప్పులు.
  - ప్రతి ఆఫర్‌లో దూరం, చెల్లింపు ముందే కనిపిస్తాయి
  - దుకాణం వద్ద 5 నిమిషాలు దాటిన నిరీక్షణకు చెల్లింపు
  - స్పష్టమైన స్టేట్‌మెంట్‌తో వారపు చెల్లింపులు
  - మీరు ఆన్‌లైన్‌లో ఉన్నప్పుడే లొకేషన్ వాడతాం: దగ్గరి ఆర్డర్లు పంపడానికి, కస్టమర్లకు వారి ఆర్డర్ ఎక్కడుందో చూపడానికి

**Background location declaration (Play).** The rider app uses location in the background only while the rider
is online. It is used to offer nearby deliveries and to show the customer the live position of their order.
Going offline stops location collection. A foreground notification is shown the whole time.

## Data safety (Play) — summary
| App | Collected | Shared | Notes |
|---|---|---|---|
| Consumer | Phone number, name, delivery addresses and approximate location, order history, crash logs | With the store and rider for an order (masked phone; the full address only after the store accepts or the rider is assigned) | Encrypted in transit; deletion in-app (Account → Privacy and help) |
| Merchant | Phone, business KYC documents, bank account (via KYC partner), store location | Payment partner for payouts | Deletion via the grievance officer once settlement obligations are met |
| Rider | Phone, KYC, precise location while online, bank account | The customer sees live position for active orders only | Location only while online |
