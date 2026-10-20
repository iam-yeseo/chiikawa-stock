import chiikawaAtlasUrl from '../assets/character/chiikawa-atlas-v3.png';
import hachiwareAtlasUrl from '../assets/character/hachiware-atlas-v2.png';
import usagiAtlasUrl from '../assets/character/usagi-atlas-v3.png';

// Crop coordinates are measured from the artwork; referenceSize and baseline
// retain character proportions instead of stretching each pose to a square.
export const CHARACTER_SKINS = {
  chiikawa: {
    atlasUrl:chiikawaAtlasUrl, referenceSize:300, baseline:.94,
    frames:[
      [55,52,245,259],[355,54,244,257],[655,52,245,259],[955,52,245,259],
      [57,347,234,258],[359,347,232,261],[664,347,233,261],[967,347,232,260],
      [49,648,245,252],[352,673,247,233],[644,645,246,254],[957,646,244,256],
      [55,939,245,262],[356,942,244,259],[643,941,250,259],[952,941,249,261],
    ],
    tears:{left:.33,right:.66,top:.43},
  },
  hachiware: {
    atlasUrl:hachiwareAtlasUrl, referenceSize:300, baseline:.94,
    frames:[
      [54,36,238,266],[352,33,237,268],[665,33,238,268],[971,33,238,268],
      [54,343,234,263],[361,343,233,266],[661,347,233,263],[976,346,234,262],
      [50,654,242,262],[354,683,242,229],[661,641,252,249],[974,659,241,258],
      [46,958,244,263],[350,956,243,264],[663,956,243,265],[972,956,242,266],
    ],
    tears:{left:.33,right:.66,top:0.49},
  },
  usagi: {
    atlasUrl:usagiAtlasUrl, referenceSize:315, baseline:.94,
    frames:[
      [67,18,200,290],[375,18,200,290],[685,18,201,292],[996,18,199,290],
      [57,324,200,291],[387,322,202,294],[676,329,200,288],[1000,323,199,293],
      [67,635,200,281],[375,666,197,247],[672,632,223,266],[997,641,202,270],
      [63,965,203,254],[365,950,197,273],[689,949,199,281],[1000,944,199,281],
    ],
    tears:{left:.33,right:.66,top:0.56},
  },
};
