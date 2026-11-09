// Ligne « Leboncoin » en haut du Fil : où en est la lecture automatique de 10 h (src/background/
// lbc-tour-runner.js), avec de quoi la couper ou la lancer tout de suite.
import { tourText } from '../common/lbc-tour.js';
import { tourLine } from './tour-line.js';

export const lbcTourLine = () => tourLine({ site: 'Leboncoin', messages: { status: 'LBC_TOUR_STATUS', set: 'LBC_TOUR_SET', run: 'LBC_TOUR_RUN_NOW' }, tourText });
