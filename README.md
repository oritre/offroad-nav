# offroad-nav · ניווט שטח

אפליקציית ניווט שטח אישית (PWA) שעובדת על GPS, עם מפות אופליין, הקלטת מסלולים, ניווט לנקודה, ייבוא/ייצוא GPX/KML וסנכרון נקודות ומסלולים בין מכשירים.

**הריפו מכיל קוד בלבד.** תוכן מסלולים מודרכים ממנויים בתשלום נשמר רק במכשיר (ייבוא קובץ) או בספרייה פרטית ברשת הביתית, ולעולם לא נכנס לכאן (ראו `.gitignore`).

## מקורות מידע פתוחים
| שכבה | מקור | רישיון |
|---|---|---|
| מפת טיולים ישראל | Israel Hiking Map | CC BY-NC-SA 3.0, © OpenStreetMap contributors |
| OpenTopoMap | opentopomap.org | CC BY-SA, © OSM contributors, SRTM |
| תצלום אוויר / טופו עולמי | Esri World Imagery / World Topo | Esri terms, attribution required |
| CyclOSM, OSM | openstreetmap.org | ODbL |
| שבילים מסומנים | Waymarked Trails | CC BY-SA |
| גבהים (הצללה ותלת־ממד) | AWS Terrain Tiles (Terrarium) | Mapzen / various open DEMs |
| נקודות עניין (מעיינות, תצפיות, מערות…) | OpenStreetMap via Overpass API | ODbL |
| ערכים קרובים | Wikipedia geosearch | CC BY-SA |
| מזג אוויר | Open-Meteo | CC BY 4.0 |

ספריות: MapLibre GL JS (BSD-3), @tmcw/togeojson (BSD-2), Firebase JS SDK.

## הרצה מקומית
```
python3 -m http.server 8080
```
ואז http://localhost:8080 .

## סנכרון
פרויקט Firebase: `offroad-nav-879a0` (התחברות Google, Firestore עם `firestore.rules`). ההגדרות ב-`js/firebaseConfig.js` הן מזהים ציבוריים, לא סודות.



## ספריית מסלולים פרטית
קבצי מסלול (JSON) נמצאים בתיקייה `offroad-nav-routes` בגוגל דרייב של הבעלים, והאפליקציה קוראת אותם בהרשאת קריאה בלבד אחרי התחברות. קובץ `routes.json` אופציונלי באותה תיקייה מוסיף פרטים לחיפוש (אזור, אורך, קושי, מיקום). מסלול שהורד נשמר במכשיר יחד עם המפות סביבו, ועובד בלי קליטה.
