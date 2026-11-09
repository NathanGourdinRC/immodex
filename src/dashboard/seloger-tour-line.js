// Ligne « SeLoger » en haut du Fil : où en est la lecture automatique de 11 h des annonces sans
// adresse (src/background/seloger-tour-runner.js), avec de quoi la couper ou la lancer tout de suite.
import { tourText } from '../common/seloger-tour.js';
import { tourLine } from './tour-line.js';

export const selogerTourLine = () => tourLine({ site: 'SeLoger', messages: { status: 'SELOGER_TOUR_STATUS', set: 'SELOGER_TOUR_SET', run: 'SELOGER_TOUR_RUN_NOW' }, tourText });
