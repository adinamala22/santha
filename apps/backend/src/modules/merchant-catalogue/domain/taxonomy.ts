import type { MerchantType } from './merchant';

export interface Category {
  slug: string;
  name: string;
  nameTe: string;
  /** Supply types whose merchants may file items here (FR-DIS-3: every live SKU has a category). */
  types: readonly MerchantType[];
}

const R: readonly MerchantType[] = ['retail'];
const RH: readonly MerchantType[] = ['retail', 'home_business'];
const F: readonly MerchantType[] = ['fashion'];
const H: readonly MerchantType[] = ['home_business'];
const K: readonly MerchantType[] = ['home_kitchen'];

/**
 * Platform taxonomy (PRD 8.2). Kept in code: it changes with releases, not per micro-market, and
 * the apps ship the same list. Slugs are stable identifiers stored on items and master products.
 */
export const CATEGORIES: readonly Category[] = [
  { slug: 'staples', name: 'Atta, rice & dal', nameTe: 'అట్టా, బియ్యం & పప్పులు', types: R },
  { slug: 'oils_ghee', name: 'Oils & ghee', nameTe: 'నూనెలు & నెయ్యి', types: R },
  { slug: 'masala', name: 'Masalas & spices', nameTe: 'మసాలాలు', types: RH },
  { slug: 'dairy', name: 'Milk, curd & paneer', nameTe: 'పాలు, పెరుగు & పనీర్', types: R },
  { slug: 'breakfast', name: 'Breakfast & instant food', nameTe: 'బ్రేక్‌ఫాస్ట్ & ఇన్‌స్టంట్ ఫుడ్', types: R },
  { slug: 'snacks', name: 'Snacks & namkeen', nameTe: 'స్నాక్స్ & నమ్కీన్', types: RH },
  { slug: 'biscuits', name: 'Biscuits & chocolates', nameTe: 'బిస్కెట్లు & చాక్లెట్లు', types: R },
  { slug: 'beverages', name: 'Tea, coffee & drinks', nameTe: 'టీ, కాఫీ & పానీయాలు', types: R },
  { slug: 'fruits', name: 'Fruits', nameTe: 'పండ్లు', types: R },
  { slug: 'vegetables', name: 'Vegetables', nameTe: 'కూరగాయలు', types: R },
  { slug: 'meat_fish', name: 'Meat & fish', nameTe: 'మాంసం & చేపలు', types: R },
  { slug: 'eggs', name: 'Eggs', nameTe: 'గుడ్లు', types: R },
  { slug: 'bakery', name: 'Bread & bakery', nameTe: 'బ్రెడ్ & బేకరీ', types: R },
  { slug: 'personal_care', name: 'Personal care', nameTe: 'వ్యక్తిగత సంరక్షణ', types: R },
  { slug: 'household', name: 'Cleaning & household', nameTe: 'క్లీనింగ్ & ఇంటి సామాగ్రి', types: R },
  { slug: 'baby_care', name: 'Baby care', nameTe: 'శిశు సంరక్షణ', types: R },
  { slug: 'otc_medicines', name: 'Medicines (OTC)', nameTe: 'మందులు (OTC)', types: R },
  { slug: 'wellness', name: 'Health & wellness', nameTe: 'ఆరోగ్యం & వెల్‌నెస్', types: R },
  { slug: 'pooja', name: 'Pooja needs', nameTe: 'పూజ సామాగ్రి', types: RH },
  { slug: 'stationery', name: 'Stationery', nameTe: 'స్టేషనరీ', types: R },
  { slug: 'electronics', name: 'Electronics & accessories', nameTe: 'ఎలక్ట్రానిక్స్', types: R },
  { slug: 'other_retail', name: 'Other', nameTe: 'ఇతరాలు', types: R },
  { slug: 'sarees', name: 'Sarees', nameTe: 'చీరలు', types: F },
  { slug: 'women_wear', name: 'Women', nameTe: 'మహిళలు', types: F },
  { slug: 'men_wear', name: 'Men', nameTe: 'పురుషులు', types: F },
  { slug: 'kids_wear', name: 'Kids', nameTe: 'పిల్లలు', types: F },
  { slug: 'footwear', name: 'Footwear', nameTe: 'పాదరక్షలు', types: F },
  { slug: 'accessories', name: 'Accessories', nameTe: 'యాక్సెసరీలు', types: F },
  { slug: 'pickles', name: 'Pickles & podis', nameTe: 'పచ్చళ్ళు & పొడులు', types: H },
  { slug: 'sweets', name: 'Sweets & pindivantalu', nameTe: 'స్వీట్లు & పిండివంటలు', types: H },
  { slug: 'cakes', name: 'Cakes & bakes', nameTe: 'కేకులు & బేక్స్', types: H },
  { slug: 'crafts', name: 'Crafts & decor', nameTe: 'హస్తకళలు & అలంకరణ', types: H },
  { slug: 'gifts', name: 'Gifts & return gifts', nameTe: 'బహుమతులు', types: H },
  { slug: 'meals', name: 'Meals', nameTe: 'భోజనం', types: K },
  { slug: 'tiffins', name: 'Tiffins', nameTe: 'టిఫిన్లు', types: K },
  { slug: 'curries', name: 'Curries & pulusu', nameTe: 'కూరలు & పులుసు', types: K },
  { slug: 'biryani', name: 'Biryani & rice', nameTe: 'బిర్యానీ & అన్నం', types: K },
  { slug: 'kitchen_snacks', name: 'Snacks', nameTe: 'స్నాక్స్', types: K },
  { slug: 'kitchen_sweets', name: 'Sweets', nameTe: 'స్వీట్లు', types: K },
];

const BY_SLUG = new Map(CATEGORIES.map((c) => [c.slug, c]));

export const categoryBySlug = (slug: string): Category | undefined => BY_SLUG.get(slug);

const RANK = new Map(CATEGORIES.map((c, i) => [c.slug, i]));
/** Position in the platform taxonomy (staples first); unknown slugs last. Orders store pages. */
export const categoryRank = (slug: string): number => RANK.get(slug) ?? CATEGORIES.length;

export const categoriesFor = (type: MerchantType): Category[] => CATEGORIES.filter((c) => c.types.includes(type));

export const categoryAllowed = (slug: string, type: MerchantType): boolean => !!BY_SLUG.get(slug)?.types.includes(type);
