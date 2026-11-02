import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { DAYS, type Day } from '../common/hours';
import type { FoodMark, ItemRecord, ItemUnit, MasterProductRecord, MediaRecord, SlotRecord, StockState } from '../modules/merchant-catalogue/domain/catalogue';
import { type MasterRow, parseMasterCsv, seedMasterId } from '../modules/merchant-catalogue/domain/master-import';
import { SEED_MERCHANTS, seedStorePhotoId, seedUserId } from './seed-data';

/** Demo master catalogue (fictional brands, synthetic barcodes) — also an example input for `pnpm catalogue:import`. */
export const MASTER_CSV_PATH = resolve(__dirname, '../../prisma/data/master-products.csv');

let masterCache: MasterRow[] | null = null;
export function seedMasterRows(): MasterRow[] {
  if (!masterCache) {
    const { rows, rejected } = parseMasterCsv(readFileSync(MASTER_CSV_PATH, 'utf8'), 'seed');
    if (rejected.length) throw new Error(`master-products.csv has bad rows: ${JSON.stringify(rejected.slice(0, 3))}`);
    masterCache = rows;
  }
  return masterCache;
}

export function buildSeedMaster(now: Date): MasterProductRecord[] {
  return seedMasterRows().map((r) => ({ ...r, id: seedMasterId(r.barcode), createdAt: now, updatedAt: now }));
}

// ───────────── items ─────────────

type V = [label: string, unit: ItemUnit, qty: number, rupees: number];
interface Custom {
  name: string;
  nameTe?: string;
  category: string;
  variants: V[];
  foodMark?: FoodMark;
  allergens?: string[];
  description?: string;
  madeToOrder?: number; // lead time minutes
  days?: Day[];
  dailyCapacity?: number;
  special?: boolean;
}

const TE: Record<string, string> = {
  'Chakki Atta': 'గోధుమ పిండి',
  'Sona Masoori Rice': 'సోనా మసూరి బియ్యం',
  'Basmati Rice': 'బాస్మతి బియ్యం',
  'Toor Dal': 'కంది పప్పు',
  'Moong Dal': 'పెసర పప్పు',
  'Chana Dal': 'శనగ పప్పు',
  'Urad Dal': 'మినప పప్పు',
  'Bombay Rava': 'బొంబాయి రవ్వ',
  Sugar: 'చక్కెర',
  'Iodised Salt': 'ఉప్పు',
  Jaggery: 'బెల్లం',
  'Sunflower Oil': 'సన్‌ఫ్లవర్ నూనె',
  'Groundnut Oil': 'వేరుశెనగ నూనె',
  'Gingelly Oil': 'నువ్వుల నూనె',
  'Cow Ghee': 'ఆవు నెయ్యి',
  'Turmeric Powder': 'పసుపు',
  'Red Chilli Powder': 'కారం',
  Tamarind: 'చింతపండు',
  'Toned Milk': 'పాలు',
  Curd: 'పెరుగు',
  'Farm Eggs': 'గుడ్లు',
  'Tea Powder': 'టీ పొడి',
};

const NON_FOOD = new Set(['household', 'personal_care', 'baby_care', 'otc_medicines', 'wellness', 'pooja', 'stationery']);
const ALLERGENS_BY_NAME: Record<string, string[]> = {
  'Chakki Atta': ['gluten'],
  Maida: ['gluten'],
  'Bombay Rava': ['gluten'],
  'Idli Rava': [],
  'Milk Bread': ['gluten', 'milk'],
  'Brown Bread': ['gluten'],
  'Pav Buns': ['gluten', 'milk'],
  'Glucose Biscuits': ['gluten', 'milk'],
  'Cream Biscuits': ['gluten', 'milk'],
  'Marie Biscuits': ['gluten'],
  'Butter Cookies': ['gluten', 'milk'],
  'Milk Chocolate': ['milk', 'soy'],
  Rusk: ['gluten'],
  Butter: ['milk'],
  Paneer: ['milk'],
  'Toned Milk': ['milk'],
  'Full Cream Milk': ['milk'],
  Curd: ['milk'],
  Buttermilk: ['milk'],
  'Cow Ghee': ['milk'],
  'Mustard Seeds': ['mustard'],
  'Mustard Oil': ['mustard'],
  'Gingelly Oil': ['sesame'],
  'Groundnut Oil': ['peanut'],
  'Kara Boondi': ['peanut'],
  Mixture: ['peanut'],
  'Instant Noodles': ['gluten'],
  Vermicelli: ['gluten'],
};

/** Retail stores sell master products: one brand per product, every pack size a variant. */
function masterPicks(categories: string[], brandIndex: number, perCategory: number) {
  const rows = seedMasterRows();
  const out: Array<{ name: string; brand: string; category: string; rows: MasterRow[] }> = [];
  for (const cat of categories) {
    const inCat = rows.filter((r) => r.categorySlug === cat);
    const brands = [...new Set(inCat.map((r) => r.brand ?? ''))];
    const brand = brands[brandIndex % brands.length]!;
    const names = [...new Set(inCat.filter((r) => r.brand === brand).map((r) => r.name))].slice(0, perCategory);
    for (const name of names) out.push({ name, brand, category: cat, rows: inCat.filter((r) => r.brand === brand && r.name === name) });
  }
  return out;
}

const FRUITS_VEG: Custom[] = [
  { name: 'Tomato', nameTe: 'టమాటా', category: 'vegetables', variants: [['500 g', 'g', 500, 18], ['1 kg', 'kg', 1, 34]] },
  { name: 'Onion', nameTe: 'ఉల్లిపాయలు', category: 'vegetables', variants: [['1 kg', 'kg', 1, 38], ['2 kg', 'kg', 2, 72]] },
  { name: 'Potato', nameTe: 'బంగాళదుంపలు', category: 'vegetables', variants: [['1 kg', 'kg', 1, 36]] },
  { name: 'Brinjal', nameTe: 'వంకాయ', category: 'vegetables', variants: [['500 g', 'g', 500, 25]] },
  { name: 'Lady Finger', nameTe: 'బెండకాయ', category: 'vegetables', variants: [['500 g', 'g', 500, 30]] },
  { name: 'Green Chilli', nameTe: 'పచ్చిమిర్చి', category: 'vegetables', variants: [['250 g', 'g', 250, 15]] },
  { name: 'Drumstick', nameTe: 'మునగకాయ', category: 'vegetables', variants: [['250 g', 'g', 250, 28]] },
  { name: 'Bottle Gourd', nameTe: 'సొరకాయ', category: 'vegetables', variants: [['1 pc', 'pc', 1, 30]] },
  { name: 'Ridge Gourd', nameTe: 'బీరకాయ', category: 'vegetables', variants: [['500 g', 'g', 500, 32]] },
  { name: 'Carrot', nameTe: 'క్యారెట్', category: 'vegetables', variants: [['500 g', 'g', 500, 35]] },
  { name: 'Beetroot', nameTe: 'బీట్‌రూట్', category: 'vegetables', variants: [['500 g', 'g', 500, 28]] },
  { name: 'Cabbage', nameTe: 'క్యాబేజీ', category: 'vegetables', variants: [['1 pc', 'pc', 1, 35]] },
  { name: 'Coriander Leaves', nameTe: 'కొత్తిమీర', category: 'vegetables', variants: [['1 bunch', 'pc', 1, 10]] },
  { name: 'Curry Leaves', nameTe: 'కరివేపాకు', category: 'vegetables', variants: [['1 bunch', 'pc', 1, 5]] },
  { name: 'Gongura', nameTe: 'గోంగూర', category: 'vegetables', variants: [['1 bunch', 'pc', 1, 15]] },
  { name: 'Ginger', nameTe: 'అల్లం', category: 'vegetables', variants: [['100 g', 'g', 100, 14]] },
  { name: 'Garlic', nameTe: 'వెల్లుల్లి', category: 'vegetables', variants: [['250 g', 'g', 250, 45]] },
  { name: 'Banana (Chakkarakeli)', nameTe: 'అరటిపండ్లు చక్కెరకేళి', category: 'fruits', variants: [['6 pc', 'pc', 6, 48], ['12 pc', 'pc', 12, 90]] },
  { name: 'Apple (Shimla)', nameTe: 'ఆపిల్', category: 'fruits', variants: [['500 g', 'g', 500, 95]] },
  { name: 'Banganapalli Mango', nameTe: 'బంగినపల్లి మామిడి', category: 'fruits', variants: [['1 kg', 'kg', 1, 120]] },
  { name: 'Papaya', nameTe: 'బొప్పాయి', category: 'fruits', variants: [['1 pc', 'pc', 1, 55]] },
  { name: 'Guava', nameTe: 'జామకాయ', category: 'fruits', variants: [['500 g', 'g', 500, 40]] },
  { name: 'Sweet Lime', nameTe: 'బత్తాయి', category: 'fruits', variants: [['1 kg', 'kg', 1, 80]] },
  { name: 'Pomegranate', nameTe: 'దానిమ్మ', category: 'fruits', variants: [['500 g', 'g', 500, 110]] },
  { name: 'Tender Coconut', nameTe: 'కొబ్బరి బొండం', category: 'fruits', variants: [['1 pc', 'pc', 1, 45]] },
];

const CUSTOM: Record<string, Custom[]> = {
  '+919000000203': FRUITS_VEG,
  '+919000000205': [
    { name: 'Venkatagiri Cotton Saree', nameTe: 'వెంకటగిరి కాటన్ చీర', category: 'sarees', variants: [['Free size', 'pc', 1, 2450]] },
    { name: 'Pochampally Ikat Saree', nameTe: 'పోచంపల్లి ఇక్కత్ చీర', category: 'sarees', variants: [['Free size', 'pc', 1, 4200]] },
    { name: 'Mangalagiri Silk Cotton Saree', nameTe: 'మంగళగిరి చీర', category: 'sarees', variants: [['Free size', 'pc', 1, 3100]] },
    { name: 'Cotton Kurti', category: 'women_wear', variants: [['S', 'pc', 1, 650], ['M', 'pc', 1, 650], ['L', 'pc', 1, 650], ['XL', 'pc', 1, 690]] },
    { name: 'Festive Lehenga (Kids)', category: 'kids_wear', variants: [['4-6 yrs', 'pc', 1, 1450], ['7-9 yrs', 'pc', 1, 1650]] },
    { name: 'Silk Dupatta', category: 'accessories', variants: [['Free size', 'pc', 1, 750]] },
    { name: 'Handloom Cotton Shirt', category: 'men_wear', variants: [['M', 'pc', 1, 899], ['L', 'pc', 1, 899], ['XL', 'pc', 1, 949]] },
    { name: 'Oxidised Jhumkas', category: 'accessories', variants: [['1 pair', 'pc', 1, 350]] },
  ],
  '+919000000206': [
    { name: 'Leather Chappals (Men)', category: 'footwear', variants: [['7', 'pc', 1, 499], ['8', 'pc', 1, 499], ['9', 'pc', 1, 499], ['10', 'pc', 1, 499]] },
    { name: 'School Shoes Black', category: 'footwear', variants: [['2', 'pc', 1, 599], ['4', 'pc', 1, 649], ['6', 'pc', 1, 699]] },
    { name: 'Ladies Sandals', category: 'footwear', variants: [['5', 'pc', 1, 549], ['6', 'pc', 1, 549], ['7', 'pc', 1, 549]] },
    { name: 'Hawai Slippers', category: 'footwear', variants: [['8', 'pc', 1, 149], ['9', 'pc', 1, 149]] },
    { name: 'Sports Shoes', category: 'footwear', variants: [['8', 'pc', 1, 1299], ['9', 'pc', 1, 1299]] },
    { name: 'Kids Sandals', category: 'footwear', variants: [['10C', 'pc', 1, 349], ['12C', 'pc', 1, 349]] },
  ],
  '+919000000207': [
    { name: 'Avakaya (Mango Pickle)', nameTe: 'ఆవకాయ', category: 'pickles', variants: [['250 g', 'g', 250, 180], ['500 g', 'g', 500, 340]], foodMark: 'veg', allergens: ['mustard'] },
    { name: 'Gongura Pickle', nameTe: 'గోంగూర పచ్చడి', category: 'pickles', variants: [['250 g', 'g', 250, 170], ['500 g', 'g', 500, 320]], foodMark: 'veg', allergens: ['mustard'] },
    { name: 'Lemon Pickle', nameTe: 'నిమ్మకాయ పచ్చడి', category: 'pickles', variants: [['250 g', 'g', 250, 150]], foodMark: 'veg', allergens: ['mustard'] },
    { name: 'Tomato Pickle', nameTe: 'టమాటా పచ్చడి', category: 'pickles', variants: [['250 g', 'g', 250, 140]], foodMark: 'veg' },
    { name: 'Chicken Pickle', nameTe: 'చికెన్ పచ్చడి', category: 'pickles', variants: [['250 g', 'g', 250, 380]], foodMark: 'non_veg', allergens: ['mustard'] },
    { name: 'Kandi Podi', nameTe: 'కంది పొడి', category: 'pickles', variants: [['200 g', 'g', 200, 120]], foodMark: 'veg' },
    { name: 'Nalla Karam Podi', nameTe: 'నల్ల కారం పొడి', category: 'pickles', variants: [['200 g', 'g', 200, 130]], foodMark: 'veg', allergens: ['sesame'] },
    { name: 'Sunnundalu', nameTe: 'సున్నుండలు', category: 'sweets', variants: [['250 g', 'g', 250, 220]], foodMark: 'veg', allergens: ['milk'], madeToOrder: 240 },
  ],
  '+919000000208': [
    { name: 'Hand-painted Clay Diyas (set of 6)', nameTe: 'మట్టి దీపాలు', category: 'crafts', variants: [['Set of 6', 'pack', 1, 240]] },
    { name: 'Mango Leaf Toran', nameTe: 'తోరణం', category: 'crafts', variants: [['1 pc', 'pc', 1, 450]], madeToOrder: 1440 },
    { name: 'Kalamkari Wall Hanging', category: 'crafts', variants: [['Small', 'pc', 1, 650], ['Large', 'pc', 1, 1200]] },
    { name: 'Return Gift Potli Bags (10)', category: 'gifts', variants: [['Pack of 10', 'pack', 1, 500]], madeToOrder: 2880 },
    { name: 'Rangoli Stencils', category: 'crafts', variants: [['Set of 5', 'pack', 1, 180]] },
    { name: 'Decorated Pooja Thali', category: 'gifts', variants: [['1 pc', 'pc', 1, 799]], madeToOrder: 1440 },
  ],
  '+919000000209': [
    { name: 'Eggless Chocolate Cake', category: 'cakes', variants: [['500 g', 'g', 500, 550], ['1 kg', 'kg', 1, 1000]], foodMark: 'veg', allergens: ['gluten', 'milk'], madeToOrder: 240 },
    { name: 'Eggless Pineapple Cake', category: 'cakes', variants: [['500 g', 'g', 500, 500], ['1 kg', 'kg', 1, 900]], foodMark: 'veg', allergens: ['gluten', 'milk'], madeToOrder: 240 },
    { name: 'Red Velvet Cupcakes (6)', category: 'cakes', variants: [['6 pc', 'pc', 6, 420]], foodMark: 'egg', allergens: ['gluten', 'milk', 'egg'], madeToOrder: 180 },
    { name: 'Atta Jaggery Cookies', category: 'cakes', variants: [['250 g', 'g', 250, 260]], foodMark: 'veg', allergens: ['gluten', 'milk'] },
    { name: 'Badam Cookies', category: 'cakes', variants: [['250 g', 'g', 250, 320]], foodMark: 'veg', allergens: ['gluten', 'milk', 'tree_nuts'] },
    { name: 'Banana Walnut Loaf', category: 'cakes', variants: [['400 g', 'g', 400, 380]], foodMark: 'egg', allergens: ['gluten', 'egg', 'tree_nuts'], madeToOrder: 180 },
  ],
  '+919000000210': [
    { name: 'Nellore Chepala Pulusu with Rice (serves 2)', nameTe: 'నెల్లూరు చేపల పులుసు', category: 'curries', variants: [['Serves 2', 'portion', 2, 320]], foodMark: 'non_veg', allergens: ['fish', 'mustard'], dailyCapacity: 15, special: true, description: 'Tangy tamarind fish curry, the Nellore way.' },
    { name: 'Veg Meals', nameTe: 'వెజ్ మీల్స్', category: 'meals', variants: [['1 plate', 'portion', 1, 140]], foodMark: 'veg', allergens: ['milk'], dailyCapacity: 40, description: 'Rice, pappu, curry, sambar, rasam, curd, pickle.' },
    { name: 'Kodi Kura with Rice', nameTe: 'కోడి కూర', category: 'curries', variants: [['Serves 1', 'portion', 1, 210], ['Serves 2', 'portion', 2, 400]], foodMark: 'non_veg', dailyCapacity: 20 },
    { name: 'Tomato Pappu', nameTe: 'టమాటా పప్పు', category: 'curries', variants: [['300 ml', 'ml', 300, 90]], foodMark: 'veg', dailyCapacity: 25 },
    { name: 'Gongura Mutton', nameTe: 'గోంగూర మటన్', category: 'curries', variants: [['Serves 2', 'portion', 2, 520]], foodMark: 'non_veg', dailyCapacity: 8, days: ['sat', 'sun'] },
    { name: 'Chicken Dum Biryani', nameTe: 'చికెన్ బిర్యానీ', category: 'biryani', variants: [['Serves 1', 'portion', 1, 230], ['Serves 2', 'portion', 2, 440]], foodMark: 'non_veg', allergens: ['milk'], dailyCapacity: 20, days: ['fri', 'sat', 'sun'] },
    { name: 'Curd Rice', nameTe: 'పెరుగు అన్నం', category: 'biryani', variants: [['1 bowl', 'portion', 1, 70]], foodMark: 'veg', allergens: ['milk', 'mustard'], dailyCapacity: 30 },
    { name: 'Bobbatlu (2 pc)', nameTe: 'బొబ్బట్లు', category: 'kitchen_sweets', variants: [['2 pc', 'pc', 2, 80]], foodMark: 'veg', allergens: ['gluten', 'milk'], dailyCapacity: 20 },
  ],
  '+919000000211': [
    { name: 'Idli (4 pc) with Chutney & Sambar', nameTe: 'ఇడ్లీ', category: 'tiffins', variants: [['4 pc', 'portion', 1, 50]], foodMark: 'veg', dailyCapacity: 60 },
    { name: 'Plain Dosa', nameTe: 'దోశ', category: 'tiffins', variants: [['1 pc', 'portion', 1, 45]], foodMark: 'veg', dailyCapacity: 50 },
    { name: 'Pesarattu Upma', nameTe: 'పెసరట్టు ఉప్మా', category: 'tiffins', variants: [['1 pc', 'portion', 1, 75]], foodMark: 'veg', allergens: ['gluten'], dailyCapacity: 30, special: true },
    { name: 'Vada (2 pc)', nameTe: 'వడ', category: 'tiffins', variants: [['2 pc', 'portion', 1, 40]], foodMark: 'veg', dailyCapacity: 40 },
    { name: 'Poori Kurma', nameTe: 'పూరీ', category: 'tiffins', variants: [['3 pc', 'portion', 1, 65]], foodMark: 'veg', allergens: ['gluten'], dailyCapacity: 30 },
    { name: 'Filter Coffee', nameTe: 'ఫిల్టర్ కాఫీ', category: 'tiffins', variants: [['1 cup', 'ml', 150, 25]], foodMark: 'veg', allergens: ['milk'], dailyCapacity: 80 },
  ],
  '+919000000212': [
    { name: 'Andhra Meals', nameTe: 'ఆంధ్ర భోజనం', category: 'meals', variants: [['1 plate', 'portion', 1, 150]], foodMark: 'veg', allergens: ['milk'], dailyCapacity: 30 },
    { name: 'Pulihora', nameTe: 'పులిహోర', category: 'biryani', variants: [['1 bowl', 'portion', 1, 70]], foodMark: 'veg', allergens: ['peanut', 'mustard'], dailyCapacity: 25 },
    { name: 'Egg Curry with Rice', nameTe: 'గుడ్డు కూర', category: 'curries', variants: [['Serves 1', 'portion', 1, 130]], foodMark: 'egg', allergens: ['egg'], dailyCapacity: 20 },
    { name: 'Sambar Rice', nameTe: 'సాంబార్ అన్నం', category: 'biryani', variants: [['1 bowl', 'portion', 1, 80]], foodMark: 'veg', dailyCapacity: 25 },
    { name: 'Semiya Payasam', nameTe: 'సేమియా పాయసం', category: 'kitchen_sweets', variants: [['200 ml', 'ml', 200, 60]], foodMark: 'veg', allergens: ['milk', 'gluten', 'tree_nuts'], dailyCapacity: 20 },
  ],
};

/** Which master categories each retail store sells: [categories, brand index, products per category]. */
const RETAIL: Record<string, [string[], number, number]> = {
  '+919000000201': [['staples', 'oils_ghee', 'masala', 'dairy', 'snacks', 'biscuits', 'beverages', 'household', 'personal_care', 'eggs'], 0, 5],
  '+919000000202': [['staples', 'oils_ghee', 'masala', 'dairy', 'breakfast', 'snacks', 'biscuits', 'beverages', 'household', 'personal_care', 'baby_care', 'pooja', 'bakery', 'stationery'], 1, 5],
  '+919000000204': [['otc_medicines', 'wellness', 'baby_care', 'personal_care'], 0, 5],
};

/** Kitchen delivery slots (lunch / dinner / breakfast windows). */
const SLOTS: Record<string, Array<Omit<SlotRecord, 'id' | 'merchantId' | 'position'>>> = {
  '+919000000210': [
    { label: 'Lunch', days: [...DAYS], start: '12:30', end: '13:00', cutoffMin: 90, capacity: 12 },
    { label: 'Late lunch', days: [...DAYS], start: '13:30', end: '14:00', cutoffMin: 90, capacity: 10 },
    { label: 'Dinner', days: [...DAYS], start: '19:30', end: '20:00', cutoffMin: 120, capacity: 12 },
  ],
  '+919000000211': [
    { label: 'Early breakfast', days: [...DAYS], start: '07:00', end: '07:30', cutoffMin: 45, capacity: 20 },
    { label: 'Breakfast', days: [...DAYS], start: '08:00', end: '08:30', cutoffMin: 45, capacity: 25 },
  ],
  '+919000000212': [{ label: 'Lunch', days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'], start: '12:30', end: '13:30', cutoffMin: 120, capacity: 15 }],
};

const itemId = (n: number, k: number) => `40000000-0000-4000-8000-${String(n).padStart(3, '0')}${String(k).padStart(9, '0')}`;
const variantId = (n: number, k: number, i: number) =>
  `70000000-0000-4000-8000-${String(n).padStart(3, '0')}${String(k).padStart(7, '0')}${String(i).padStart(2, '0')}`;
const slotId = (n: number, k: number) => `60000000-0000-4000-8000-${String(n).padStart(3, '0')}${String(k).padStart(9, '0')}`;

/** A few variants are low or out so stock states show up in demos. */
const stockFor = (k: number): StockState => (k % 17 === 5 ? 'out' : k % 11 === 3 ? 'low' : 'in');

/** Shelf price: MRP less a small deterministic discount, whole rupees, never above MRP. */
const shelfPrice = (mrpPaise: number, k: number) => Math.max(100, Math.floor((mrpPaise * (100 - (k % 4) * 2)) / 100 / 100) * 100);

export interface SeedCatalogue {
  items: ItemRecord[];
  slots: SlotRecord[];
}

/**
 * The demo catalogue for the 12 seeded merchants (~200 items). Items are confirmed at `now`, so a
 * fresh fake-mode boot has nothing stale; move the dev clock 72 h to see staleness.
 */
export function buildSeedCatalogue(now: Date, marketIdOf: (merchantId: string) => string | null): SeedCatalogue {
  const out: SeedCatalogue = { items: [], slots: [] };
  const today = new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
  for (const s of SEED_MERCHANTS) {
    const n = Number(s.ownerPhone.slice(-3));
    const base = {
      merchantId: s.id,
      microMarketId: marketIdOf(s.id),
      reviewReason: null,
      imageIds: [] as string[],
      confirmedAt: now,
      staleSince: null,
      createdBy: seedUserId(s.ownerPhone),
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      status: 'active' as const,
      maxPerOrder: null,
      dailyCapacity: null,
      specialOn: null,
      availableDays: [] as Day[],
    };
    let k = 0;
    const retail = RETAIL[s.ownerPhone];
    if (retail)
      for (const p of masterPicks(...retail)) {
        const id = itemId(n, ++k);
        const food = s.sellsFood && !NON_FOOD.has(p.category);
        out.items.push({
          ...base,
          id,
          masterProductId: seedMasterId(p.rows[0]!.barcode),
          name: `${p.brand} ${p.name}`,
          nameTe: TE[p.name] ?? null,
          description: null,
          brand: p.brand,
          categorySlug: p.category,
          foodMark: food || p.category === 'eggs' ? (p.category === 'eggs' ? 'egg' : 'veg') : null,
          allergens: ALLERGENS_BY_NAME[p.name] ?? [],
          madeToOrder: false,
          leadTimeMin: null,
          source: 'master',
          variants: p.rows.map((r, i) => ({
            id: variantId(n, k, i),
            itemId: id,
            label: r.packLabel ?? '1 pc',
            unit: r.unit ?? 'pc',
            unitQty: r.unitQty ?? 1,
            pricePaise: shelfPrice(r.mrpPaise!, k + i),
            mrpPaise: r.mrpPaise,
            stock: stockFor(k * 3 + i),
            position: i,
          })),
        });
      }
    for (const c of CUSTOM[s.ownerPhone] ?? []) {
      const id = itemId(n, ++k);
      out.items.push({
        ...base,
        id,
        masterProductId: null,
        name: c.name,
        nameTe: c.nameTe ?? null,
        description: c.description ?? null,
        brand: null,
        categorySlug: c.category,
        foodMark: c.foodMark ?? (s.type === 'home_kitchen' || (s.sellsFood && ['fruits', 'vegetables'].includes(c.category)) ? 'veg' : null),
        allergens: c.allergens ?? [],
        madeToOrder: c.madeToOrder != null,
        leadTimeMin: c.madeToOrder ?? null,
        availableDays: c.days ?? [],
        dailyCapacity: c.dailyCapacity ?? null,
        specialOn: c.special ? today : null,
        source: 'merchant',
        variants: c.variants.map(([label, unit, qty, rupees], i) => ({
          id: variantId(n, k, i),
          itemId: id,
          label,
          unit,
          unitQty: qty,
          pricePaise: rupees * 100,
          mrpPaise: null,
          stock: stockFor(k * 3 + i),
          position: i,
        })),
      });
    }
    (SLOTS[s.ownerPhone] ?? []).forEach((sl, i) => out.slots.push({ ...sl, id: slotId(n, i + 1), merchantId: s.id, position: i }));
  }
  return out;
}

// ───────────── store photos ─────────────

const TYPE_COLOURS: Record<string, [string, string]> = {
  retail: ['#2E2A7B', '#F5A623'],
  fashion: ['#7A1F5C', '#F7E7CE'],
  home_business: ['#1F6F4A', '#FFF8EC'],
  home_kitchen: ['#B23A1E', '#FFF8EC'],
};

/** A simple generated store-front tile (name on brand colours) so demo stores have a photo. */
export async function renderStorePhoto(name: string, type: string): Promise<Buffer> {
  const [bg, fg] = TYPE_COLOURS[type] ?? TYPE_COLOURS.retail!;
  const safe = name.replace(/[<>&"']/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640"><rect width="960" height="640" fill="${bg}"/><rect x="40" y="40" width="880" height="560" rx="32" fill="none" stroke="${fg}" stroke-width="6"/><text x="480" y="340" font-family="sans-serif" font-size="64" font-weight="700" fill="${fg}" text-anchor="middle">${safe}</text><text x="480" y="420" font-family="sans-serif" font-size="32" fill="${fg}" text-anchor="middle">Nellore · Santha demo</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Approved store-photo media rows for the seeded merchants that have photos (non-drafts). */
export function seedStorePhotoRecords(now: Date): Array<MediaRecord & { storeName: string; storeType: string }> {
  return SEED_MERCHANTS.filter((s) => s.status !== 'draft').map((s) => {
    const n = Number(s.ownerPhone.slice(-3));
    const id = seedStorePhotoId(n);
    return {
      id,
      merchantId: s.id,
      purpose: 'store' as const,
      status: 'approved' as const,
      contentType: 'image/png',
      originalKey: `originals/${s.id}/seed-store`,
      variants: null, // filled when rendered
      rejectReason: null,
      uploadedBy: seedUserId(s.ownerPhone),
      reviewedBy: seedUserId('+919000000900'),
      reviewedAt: now,
      createdAt: now,
      storeName: s.name,
      storeType: s.type,
    };
  });
}
