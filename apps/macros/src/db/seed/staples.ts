import type { Food } from '@/domain/types'

/**
 * Hand-checked staples, kept separate from the generated set.
 *
 * These 46 rows were written and verified by hand, and the demo data refers to them by exact
 * description ("Oats, rolled, dry"). `scripts/build-food-seed.mjs` regenerates the *other* file, so
 * keeping them here is what stops a re-run silently dropping curated data — and what stops the demo
 * breaking because USDA now ranks a different oat first.
 *
 * Ids are `seed:*` so a USDA row (`usda:<fdcId>`) can never collide with one.
 *
 * The micronutrients came from `scripts/fill-staple-micros.mjs`, which fills only the fields that were
 * null and only from a generic USDA row whose macros match — so the hand-checked energy and macros stay
 * authoritative and a mismatched candidate leaves the gap rather than inventing a figure. A remaining
 * null is a field USDA does not record for that food either.
 */
export const STAPLE_FOODS: Omit<Food, 'createdAt' | 'updatedAt' | 'deletedAt' | 'clientRev'>[] =

[
  {
    "id": "seed:0",
    "source": "usda",
    "description": "Chicken breast, skinless, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 120,
      "proteinMg": 22500,
      "carbsMg": 0,
      "fatMg": 2600,
      "fiberMg": 0,
      "sugarMg": null,
      "satFatMg": 349,
      "sodiumMg": 66,
      "potassiumMg": 330,
      "cholesterolMg": 73,
      "calciumMg": 4,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p0-0",
        "label": "1 breast",
        "grams": 174,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:1",
    "source": "usda",
    "description": "Chicken thigh, skinless, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 143,
      "proteinMg": 19700,
      "carbsMg": 0,
      "fatMg": 6600,
      "fiberMg": 0,
      "sugarMg": null,
      "satFatMg": 1658,
      "sodiumMg": 62,
      "potassiumMg": 272,
      "cholesterolMg": 92,
      "calciumMg": 6,
      "ironMg": 1
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p1-0",
        "label": "1 thigh",
        "grams": 111,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:2",
    "source": "usda",
    "description": "Ground beef, 90% lean, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 176,
      "proteinMg": 20000,
      "carbsMg": 0,
      "fatMg": 10000,
      "fiberMg": 0,
      "sugarMg": 0,
      "satFatMg": 3927,
      "sodiumMg": 66,
      "potassiumMg": 321,
      "cholesterolMg": 65,
      "calciumMg": 12,
      "ironMg": 2
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p2-0",
        "label": "4 oz",
        "grams": 113,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:3",
    "source": "usda",
    "description": "Salmon, Atlantic, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 208,
      "proteinMg": 20400,
      "carbsMg": 0,
      "fatMg": 13400,
      "fiberMg": 0,
      "sugarMg": 0,
      "satFatMg": 3050,
      "sodiumMg": 59,
      "potassiumMg": 363,
      "cholesterolMg": 55,
      "calciumMg": 9,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p3-0",
        "label": "1 fillet",
        "grams": 198,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:4",
    "source": "usda",
    "description": "Egg, whole, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 143,
      "proteinMg": 12600,
      "carbsMg": 700,
      "fatMg": 9500,
      "fiberMg": 0,
      "sugarMg": 200,
      "satFatMg": 3200,
      "sodiumMg": 129,
      "potassiumMg": 132,
      "cholesterolMg": 411,
      "calciumMg": 48,
      "ironMg": 2
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p4-0",
        "label": "1 large",
        "grams": 50,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:5",
    "source": "usda",
    "description": "Egg white, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 52,
      "proteinMg": 10900,
      "carbsMg": 700,
      "fatMg": 200,
      "fiberMg": 0,
      "sugarMg": 710,
      "satFatMg": 0,
      "sodiumMg": 166,
      "potassiumMg": 163,
      "cholesterolMg": 0,
      "calciumMg": 7,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p5-0",
        "label": "1 large",
        "grams": 33,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:6",
    "source": "usda",
    "description": "Greek yogurt, plain, nonfat",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 59,
      "proteinMg": 10200,
      "carbsMg": 3600,
      "fatMg": 400,
      "fiberMg": 0,
      "sugarMg": null,
      "satFatMg": 108,
      "sodiumMg": 36,
      "potassiumMg": 141,
      "cholesterolMg": 5,
      "calciumMg": 111,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p6-0",
        "label": "1 cup",
        "grams": 245,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:7",
    "source": "usda",
    "description": "Milk, 2% fat",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 50,
      "proteinMg": 3300,
      "carbsMg": 4800,
      "fatMg": 2000,
      "fiberMg": 0,
      "sugarMg": 4890,
      "satFatMg": 1110,
      "sodiumMg": 39,
      "potassiumMg": 159,
      "cholesterolMg": 8,
      "calciumMg": 126,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p7-0",
        "label": "1 cup",
        "grams": 244,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:8",
    "source": "usda",
    "description": "Cheddar cheese",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 403,
      "proteinMg": 22900,
      "carbsMg": 3100,
      "fatMg": 33100,
      "fiberMg": 0,
      "sugarMg": 330,
      "satFatMg": 19200,
      "sodiumMg": 654,
      "potassiumMg": 77,
      "cholesterolMg": 100,
      "calciumMg": 707,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p8-0",
        "label": "1 slice",
        "grams": 28,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:9",
    "source": "usda",
    "description": "Cottage cheese, 2% fat",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 84,
      "proteinMg": 11000,
      "carbsMg": 4600,
      "fatMg": 2300,
      "fiberMg": 0,
      "sugarMg": null,
      "satFatMg": 1260,
      "sodiumMg": 321,
      "potassiumMg": 120,
      "cholesterolMg": 12,
      "calciumMg": 103,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p9-0",
        "label": "1 cup",
        "grams": 226,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:10",
    "source": "usda",
    "description": "Whey protein isolate powder",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 370,
      "proteinMg": 80000,
      "carbsMg": 8000,
      "fatMg": 2000,
      "fiberMg": 0,
      "sugarMg": 0,
      "satFatMg": 781,
      "sodiumMg": 156,
      "potassiumMg": 500,
      "cholesterolMg": 16,
      "calciumMg": 469,
      "ironMg": 1
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p10-0",
        "label": "1 scoop",
        "grams": 30,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:11",
    "source": "usda",
    "description": "Tofu, firm",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 144,
      "proteinMg": 17300,
      "carbsMg": 2800,
      "fatMg": 8700,
      "fiberMg": 2300,
      "sugarMg": null,
      "satFatMg": 1261,
      "sodiumMg": 14,
      "potassiumMg": 237,
      "cholesterolMg": 0,
      "calciumMg": 683,
      "ironMg": 3
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p11-0",
        "label": "1/2 cup",
        "grams": 126,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:12",
    "source": "usda",
    "description": "Black beans, cooked",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 132,
      "proteinMg": 8900,
      "carbsMg": 23700,
      "fatMg": 500,
      "fiberMg": 8700,
      "sugarMg": 320,
      "satFatMg": 139,
      "sodiumMg": 237,
      "potassiumMg": 355,
      "cholesterolMg": 0,
      "calciumMg": 27,
      "ironMg": 2
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p12-0",
        "label": "1 cup",
        "grams": 172,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:13",
    "source": "usda",
    "description": "Lentils, cooked",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 116,
      "proteinMg": 9000,
      "carbsMg": 20100,
      "fatMg": 400,
      "fiberMg": 7900,
      "sugarMg": 1800,
      "satFatMg": 53,
      "sodiumMg": 238,
      "potassiumMg": 369,
      "cholesterolMg": 0,
      "calciumMg": 19,
      "ironMg": 3
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p13-0",
        "label": "1 cup",
        "grams": 198,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:14",
    "source": "usda",
    "description": "Chickpeas, cooked",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 164,
      "proteinMg": 8900,
      "carbsMg": 27400,
      "fatMg": 2600,
      "fiberMg": 7600,
      "sugarMg": 4800,
      "satFatMg": 269,
      "sodiumMg": 243,
      "potassiumMg": 291,
      "cholesterolMg": 0,
      "calciumMg": 49,
      "ironMg": 3
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p14-0",
        "label": "1 cup",
        "grams": 164,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:15",
    "source": "usda",
    "description": "Rice, white, long-grain, cooked",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 130,
      "proteinMg": 2700,
      "carbsMg": 28200,
      "fatMg": 300,
      "fiberMg": 400,
      "sugarMg": 110,
      "satFatMg": 74,
      "sodiumMg": 2,
      "potassiumMg": 56,
      "cholesterolMg": 0,
      "calciumMg": 19,
      "ironMg": 2
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p15-0",
        "label": "1 cup",
        "grams": 158,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:16",
    "source": "usda",
    "description": "Rice, brown, cooked",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 123,
      "proteinMg": 2700,
      "carbsMg": 25600,
      "fatMg": 1000,
      "fiberMg": 1600,
      "sugarMg": 220,
      "satFatMg": 200,
      "sodiumMg": 3,
      "potassiumMg": 80,
      "cholesterolMg": 0,
      "calciumMg": 5,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p16-0",
        "label": "1 cup",
        "grams": 195,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:17",
    "source": "usda",
    "description": "Pasta, cooked",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 158,
      "proteinMg": 5800,
      "carbsMg": 30900,
      "fatMg": 900,
      "fiberMg": 1800,
      "sugarMg": 560,
      "satFatMg": 175,
      "sodiumMg": 232,
      "potassiumMg": 44,
      "cholesterolMg": 0,
      "calciumMg": 7,
      "ironMg": 1
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p17-0",
        "label": "1 cup",
        "grams": 140,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:18",
    "source": "usda",
    "description": "Bread, whole wheat",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 247,
      "proteinMg": 13000,
      "carbsMg": 41000,
      "fatMg": 3400,
      "fiberMg": 6800,
      "sugarMg": 4410,
      "satFatMg": 732,
      "sodiumMg": 430,
      "potassiumMg": 250,
      "cholesterolMg": 0,
      "calciumMg": 163,
      "ironMg": 3
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p18-0",
        "label": "1 slice",
        "grams": 28,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:19",
    "source": "usda",
    "description": "Oats, rolled, dry",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 389,
      "proteinMg": 16900,
      "carbsMg": 66300,
      "fatMg": 6900,
      "fiberMg": 10600,
      "sugarMg": 1430,
      "satFatMg": 1430,
      "sodiumMg": 5,
      "potassiumMg": 579,
      "cholesterolMg": 0,
      "calciumMg": 79,
      "ironMg": 8
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p19-0",
        "label": "1/2 cup",
        "grams": 40,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:20",
    "source": "usda",
    "description": "Potato, russet, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 79,
      "proteinMg": 2100,
      "carbsMg": 18100,
      "fatMg": 100,
      "fiberMg": 1300,
      "sugarMg": null,
      "satFatMg": null,
      "sodiumMg": 3,
      "potassiumMg": 450,
      "cholesterolMg": null,
      "calciumMg": 8,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p20-0",
        "label": "1 medium",
        "grams": 213,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:21",
    "source": "usda",
    "description": "Sweet potato, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 86,
      "proteinMg": 1600,
      "carbsMg": 20100,
      "fatMg": 100,
      "fiberMg": 3000,
      "sugarMg": null,
      "satFatMg": null,
      "sodiumMg": 0,
      "potassiumMg": 486,
      "cholesterolMg": null,
      "calciumMg": 22,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p21-0",
        "label": "1 medium",
        "grams": 130,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:22",
    "source": "usda",
    "description": "Quinoa, cooked",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 120,
      "proteinMg": 4400,
      "carbsMg": 21300,
      "fatMg": 1900,
      "fiberMg": 2800,
      "sugarMg": 870,
      "satFatMg": 231,
      "sodiumMg": 7,
      "potassiumMg": 172,
      "cholesterolMg": 0,
      "calciumMg": 17,
      "ironMg": 1
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p22-0",
        "label": "1 cup",
        "grams": 185,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:23",
    "source": "usda",
    "description": "Tortilla, flour",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 306,
      "proteinMg": 8200,
      "carbsMg": 51400,
      "fatMg": 7000,
      "fiberMg": 3000,
      "sugarMg": 3710,
      "satFatMg": 2920,
      "sodiumMg": 700,
      "potassiumMg": 125,
      "cholesterolMg": 0,
      "calciumMg": 146,
      "ironMg": 4
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p23-0",
        "label": "1 tortilla",
        "grams": 45,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:24",
    "source": "usda",
    "description": "Banana, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 89,
      "proteinMg": 1100,
      "carbsMg": 22800,
      "fatMg": 300,
      "fiberMg": 2600,
      "sugarMg": 15800,
      "satFatMg": 112,
      "sodiumMg": 0,
      "potassiumMg": 326,
      "cholesterolMg": 0,
      "calciumMg": 5,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p24-0",
        "label": "1 medium",
        "grams": 118,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:25",
    "source": "usda",
    "description": "Apple, raw, with skin",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 52,
      "proteinMg": 300,
      "carbsMg": 13800,
      "fatMg": 200,
      "fiberMg": 2400,
      "sugarMg": 13330,
      "satFatMg": null,
      "sodiumMg": 1,
      "potassiumMg": 104,
      "cholesterolMg": null,
      "calciumMg": 6,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p25-0",
        "label": "1 medium",
        "grams": 182,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:26",
    "source": "usda",
    "description": "Blueberries, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 57,
      "proteinMg": 700,
      "carbsMg": 14500,
      "fatMg": 300,
      "fiberMg": 2400,
      "sugarMg": 9360,
      "satFatMg": 28,
      "sodiumMg": 0,
      "potassiumMg": 86,
      "cholesterolMg": 0,
      "calciumMg": 12,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p26-0",
        "label": "1 cup",
        "grams": 148,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:27",
    "source": "usda",
    "description": "Strawberries, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 32,
      "proteinMg": 700,
      "carbsMg": 7700,
      "fatMg": 300,
      "fiberMg": 2000,
      "sugarMg": 4860,
      "satFatMg": 0,
      "sodiumMg": 0,
      "potassiumMg": 161,
      "cholesterolMg": 0,
      "calciumMg": 17,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p27-0",
        "label": "1 cup",
        "grams": 152,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:28",
    "source": "usda",
    "description": "Orange, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 47,
      "proteinMg": 900,
      "carbsMg": 11800,
      "fatMg": 100,
      "fiberMg": 2400,
      "sugarMg": 8960,
      "satFatMg": 15,
      "sodiumMg": 4,
      "potassiumMg": 174,
      "cholesterolMg": 0,
      "calciumMg": 42,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p28-0",
        "label": "1 medium",
        "grams": 131,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:29",
    "source": "usda",
    "description": "Avocado, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 160,
      "proteinMg": 2000,
      "carbsMg": 8500,
      "fatMg": 14700,
      "fiberMg": 6700,
      "sugarMg": 660,
      "satFatMg": 2130,
      "sodiumMg": 7,
      "potassiumMg": 485,
      "cholesterolMg": 0,
      "calciumMg": 12,
      "ironMg": 1
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p29-0",
        "label": "1/2 avocado",
        "grams": 100,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:30",
    "source": "usda",
    "description": "Broccoli, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 34,
      "proteinMg": 2800,
      "carbsMg": 6600,
      "fatMg": 400,
      "fiberMg": 2600,
      "sugarMg": 1400,
      "satFatMg": 39,
      "sodiumMg": 36,
      "potassiumMg": 303,
      "cholesterolMg": 0,
      "calciumMg": 46,
      "ironMg": 1
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p30-0",
        "label": "1 cup",
        "grams": 91,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:31",
    "source": "usda",
    "description": "Spinach, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 23,
      "proteinMg": 2900,
      "carbsMg": 3600,
      "fatMg": 400,
      "fiberMg": 2200,
      "sugarMg": 420,
      "satFatMg": 63,
      "sodiumMg": 111,
      "potassiumMg": 582,
      "cholesterolMg": 0,
      "calciumMg": 68,
      "ironMg": 1
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p31-0",
        "label": "1 cup",
        "grams": 30,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:32",
    "source": "usda",
    "description": "Carrot, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 41,
      "proteinMg": 900,
      "carbsMg": 9600,
      "fatMg": 200,
      "fiberMg": 2800,
      "sugarMg": 4750,
      "satFatMg": 28,
      "sodiumMg": 75,
      "potassiumMg": 258,
      "cholesterolMg": 0,
      "calciumMg": 36,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p32-0",
        "label": "1 medium",
        "grams": 61,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:33",
    "source": "usda",
    "description": "Bell pepper, red, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 31,
      "proteinMg": 1000,
      "carbsMg": 6000,
      "fatMg": 300,
      "fiberMg": 2100,
      "sugarMg": 4200,
      "satFatMg": 59,
      "sodiumMg": 4,
      "potassiumMg": 211,
      "cholesterolMg": 0,
      "calciumMg": 7,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p33-0",
        "label": "1 medium",
        "grams": 119,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:34",
    "source": "usda",
    "description": "Tomato, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 18,
      "proteinMg": 900,
      "carbsMg": 3900,
      "fatMg": 200,
      "fiberMg": 1200,
      "sugarMg": 2630,
      "satFatMg": 28,
      "sodiumMg": 4,
      "potassiumMg": 226,
      "cholesterolMg": 0,
      "calciumMg": 10,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p34-0",
        "label": "1 medium",
        "grams": 123,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:35",
    "source": "usda",
    "description": "Onion, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 40,
      "proteinMg": 1100,
      "carbsMg": 9300,
      "fatMg": 100,
      "fiberMg": 1700,
      "sugarMg": 5800,
      "satFatMg": 42,
      "sodiumMg": 1,
      "potassiumMg": 171,
      "cholesterolMg": 0,
      "calciumMg": 17,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p35-0",
        "label": "1 medium",
        "grams": 110,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:36",
    "source": "usda",
    "description": "Olive oil",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 884,
      "proteinMg": 0,
      "carbsMg": 0,
      "fatMg": 100000,
      "fiberMg": 0,
      "sugarMg": 0,
      "satFatMg": 15500,
      "sodiumMg": 2,
      "potassiumMg": 1,
      "cholesterolMg": 0,
      "calciumMg": 1,
      "ironMg": 1
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p36-0",
        "label": "1 tbsp",
        "grams": 14,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:37",
    "source": "usda",
    "description": "Butter, salted",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 717,
      "proteinMg": 900,
      "carbsMg": 100,
      "fatMg": 81100,
      "fiberMg": 0,
      "sugarMg": 60,
      "satFatMg": 51368,
      "sodiumMg": 643,
      "potassiumMg": 24,
      "cholesterolMg": 215,
      "calciumMg": 24,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p37-0",
        "label": "1 tbsp",
        "grams": 14,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:38",
    "source": "usda",
    "description": "Peanut butter",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 588,
      "proteinMg": 25100,
      "carbsMg": 19600,
      "fatMg": 50400,
      "fiberMg": 6000,
      "sugarMg": 10500,
      "satFatMg": 10300,
      "sodiumMg": 426,
      "potassiumMg": 558,
      "cholesterolMg": 0,
      "calciumMg": 49,
      "ironMg": 2
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p38-0",
        "label": "2 tbsp",
        "grams": 32,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:39",
    "source": "usda",
    "description": "Almonds, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 579,
      "proteinMg": 21200,
      "carbsMg": 21600,
      "fatMg": 49900,
      "fiberMg": 12500,
      "sugarMg": null,
      "satFatMg": 3785,
      "sodiumMg": 0,
      "potassiumMg": 733,
      "cholesterolMg": null,
      "calciumMg": 254,
      "ironMg": 4
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p39-0",
        "label": "1 oz",
        "grams": 28,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:40",
    "source": "usda",
    "description": "Walnuts, raw",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 654,
      "proteinMg": 15200,
      "carbsMg": 13700,
      "fatMg": 65200,
      "fiberMg": 6700,
      "sugarMg": null,
      "satFatMg": 6054,
      "sodiumMg": 0,
      "potassiumMg": 424,
      "cholesterolMg": null,
      "calciumMg": 88,
      "ironMg": 2
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p40-0",
        "label": "1 oz",
        "grams": 28,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:41",
    "source": "usda",
    "description": "Honey",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 304,
      "proteinMg": 300,
      "carbsMg": 82400,
      "fatMg": 0,
      "fiberMg": 200,
      "sugarMg": 82120,
      "satFatMg": 0,
      "sodiumMg": 4,
      "potassiumMg": 52,
      "cholesterolMg": 0,
      "calciumMg": 6,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p41-0",
        "label": "1 tbsp",
        "grams": 21,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:42",
    "source": "usda",
    "description": "Sugar, granulated",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 387,
      "proteinMg": 0,
      "carbsMg": 100000,
      "fatMg": 0,
      "fiberMg": 0,
      "sugarMg": null,
      "satFatMg": null,
      "sodiumMg": 1,
      "potassiumMg": 2,
      "cholesterolMg": null,
      "calciumMg": 1,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p42-0",
        "label": "1 tsp",
        "grams": 4,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:43",
    "source": "usda",
    "description": "Coffee, brewed",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 1,
      "proteinMg": 100,
      "carbsMg": 0,
      "fatMg": 0,
      "fiberMg": 0,
      "sugarMg": 0,
      "satFatMg": 2,
      "sodiumMg": 2,
      "potassiumMg": 49,
      "cholesterolMg": 0,
      "calciumMg": 2,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p43-0",
        "label": "1 cup",
        "grams": 237,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:44",
    "source": "usda",
    "description": "Beer, regular",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 43,
      "proteinMg": 500,
      "carbsMg": 3600,
      "fatMg": 0,
      "fiberMg": 0,
      "sugarMg": 0,
      "satFatMg": 0,
      "sodiumMg": 4,
      "potassiumMg": 27,
      "cholesterolMg": 0,
      "calciumMg": 4,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p44-0",
        "label": "12 fl oz",
        "grams": 356,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  },
  {
    "id": "seed:45",
    "source": "usda",
    "description": "Wine, red",
    "brand": null,
    "barcode": null,
    "category": null,
    "dataType": "foundation",
    "per100": {
      "kcal": 85,
      "proteinMg": 100,
      "carbsMg": 2600,
      "fatMg": 0,
      "fiberMg": 0,
      "sugarMg": 620,
      "satFatMg": 0,
      "sodiumMg": 4,
      "potassiumMg": 127,
      "cholesterolMg": 0,
      "calciumMg": 8,
      "ironMg": 0
    },
    "gramsPerMl": null,
    "portions": [
      {
        "id": "p45-0",
        "label": "5 fl oz",
        "grams": 147,
        "isDefault": true
      }
    ],
    "verifiedAt": null
  }
]
