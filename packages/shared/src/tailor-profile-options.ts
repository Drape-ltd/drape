export type TailorProfileOptionGroup = {
  label: string
  items: string[]
}

export const TAILOR_SELLER_TYPE_OPTIONS = [
  { value: 'TAILOR', label: 'Tailor', hint: 'Custom and bespoke work made to order.' },
  { value: 'BOUTIQUE', label: 'Boutique', hint: 'Ready-made garments and stock collections.' },
  {
    value: 'TAILOR_SHOP',
    label: 'Tailor shop',
    hint: 'A full studio handling custom orders and ready-made collections together.',
  },
] as const

export const TAILOR_LANGUAGE_GROUPS: TailorProfileOptionGroup[] = [
  {
    label: 'West African',
    items: ['English', 'Yoruba', 'Igbo', 'Hausa', 'Pidgin', 'Twi', 'Akan', 'Fante', 'Ga', 'Ewe', 'Wolof', 'Fulani', 'Dagbani'],
  },
  {
    label: 'East & Southern Africa',
    items: ['Swahili', 'Amharic', 'Somali', 'Zulu', 'Xhosa', 'Shona', 'Kikuyu', 'Luganda'],
  },
  { label: 'European', items: ['French', 'Portuguese', 'Spanish', 'Italian', 'German', 'Dutch'] },
  { label: 'Middle Eastern', items: ['Arabic', 'Turkish', 'Farsi'] },
  {
    label: 'South & Southeast Asian',
    items: ['Hindi', 'Urdu', 'Punjabi', 'Gujarati', 'Bengali', 'Tamil', 'Tagalog'],
  },
  { label: 'East Asian', items: ['Mandarin', 'Japanese', 'Korean'] },
]

export const TAILOR_SPECIALTY_GROUPS: TailorProfileOptionGroup[] = [
  {
    label: 'West African',
    items: ['Agbada', 'Iro & Buba', 'Ankara', 'Kaftans', 'Dashiki', 'Boubou', 'Native Wear', 'Asoebi', 'Kente'],
  },
  { label: 'Formal & Western', items: ['Suits', 'Wool Suits', 'Tuxedo', 'Shirts', 'Trousers', 'Blazers'] },
  {
    label: 'Womenswear',
    items: ['Bespoke Dress', 'Wedding Gown', 'Prom Dress', 'Bridal', 'Jumpsuit', 'Skirts', 'Blouses'],
  },
  { label: 'South Asian', items: ['Lehenga', 'Saree Blouse', 'Kurta', 'Shalwar Kameez', 'Sherwani'] },
  { label: 'Middle Eastern & North African', items: ['Abaya', 'Jalabiya', 'Kaftan'] },
  { label: 'East Asian', items: ['Qipao / Cheongsam'] },
  { label: 'Craft & Textile', items: ['Crochet', 'Knitwear', 'Embroidery', 'Beadwork', 'Adire', 'Batik'] },
  { label: 'Lifestyle & Ready-made', items: ['Two-piece Set', 'Loungewear', 'Beachwear', 'Ready-made'] },
]
