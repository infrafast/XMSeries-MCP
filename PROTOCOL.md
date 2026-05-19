// Ce fichier définit les trames OSC reçues et envoyées aux consoles BEHRINGER
// selon le protocole choisi : XAIR ou X32 { XAIR, X32 }.
//
// Convention de nommage :
// - CH désigne un channel, canal ou tranche.
// - FX désigne un effet / retour d'effet, aussi écrit fx.
// - BUS désigne un bus, moniteur, monitor ou retour.
// - XXXLEVEL : niveau / fader / gain de mix.
// - XXXMUTE  : état on/off, valeur 0 = coupé/mute, 1 = actif/on.
// - XXXNAME  : nom/configuration.
// - XXXEQLEVEL : gain d'une bande d'EQ.
// - XXXEQMUTE  : état on/off d'un EQ.
//
// Remarques de vocabulaire :
// - Façade, main LR, LR et main sont des alias.
// - Channel, canal et tranche sont des synonymes.
// - Bus, moniteur, monitor et retour sont des synonymes selon le contexte.
//
// Remarque protocole :
// XAIR et X32 partagent globalement les mêmes noms logiques de sources et destinations,
// mais certains chemins OSC ou le nombre et format des paramètres diffèrent.

CHBUSLEVEL = {"/ch/%02d/mix/%02d/level", "/ch/%02d/mix/%02d/level"} // Niveau d'un channel vers un bus : source = channel, destination = bus. Sur XAIR, les bus 7,8,9,10 correspondent aux bus FX.
FXBUSLEVEL = {"/rtn/%d/mix/%02d/level", "/fxrtn/%02d/mix/%02d/level"} // Niveau d'un retour FX vers un bus : source = retour FX, destination = bus.
CHMAINLEVEL = {"/ch/%02d/mix/fader", "/ch/%02d/mix/fader"} // Niveau d'un channel sur main.
BUSLEVEL = {"/bus/%i/mix/fader", "/bus/%02d/mix/fader"} // Niveau général d'un bus / retour / monitor.
MAINLEVEL = {"/lr/mix/fader", "/main/st/mix/fader"} // Niveau général du main LR.
FXMAINLEVEL = {"/rtn/%i/mix/fader", "/fxrtn/%02d/mix/fader"} // Niveau d'un retour FX sur main.
AUXBUSLEVEL = {"/rtn/aux/mix/%02d/level", "/auxin/%02d/mix/%02d/level"} // Niveau d'une entrée AUX vers un bus : source = AUX, destination = bus. Sur XAIR, les bus 7,8,9,10 correspondent aux bus FX.
AUXMAINLEVEL = {"/rtn/aux/mix/fader", "/auxin/%02d/mix/fader"} // Niveau d'une entrée AUX sur main.
FXDELAY = {"/fx/%d/par/01", "/fx/%1d/par/01"} // Paramètre 01 d'un effet FX, utilisé notamment pour le tap delay.
CHGAIN = {"/headamp/%02d/gain", "/ch/%02d/preamp/trim"} // Gain/préampli d'un channel. Sur XAIR : headamp gain ; sur X32 : trim de préampli du channel.
CHTRIM = {"/ch/%02d/preamp/rtntrim", "/ch/%02d/preamp/trim"} // Trim de retour/préampli d'un channel.
CHEQLEVEL = {"/ch/%02d/eq/%d/g", "/ch/%02d/eq/%d/g"} // Gain d'une bande d'EQ d'un channel.
BUSEQLEVEL = {"/bus/%d/eq/%d/g", "/bus/%02d/eq/%d/g"} // Gain d'une bande d'EQ d'un bus.
DCALEVEL = {"/dca/%d/fader", "/dca/%d/fader"} // Niveau d'un groupe DCA.

MAINMUTE = {"/lr/mix/on", "/main/st/mix/on"} // État on/off du main LR.
FXMAINMUTE = {"/rtn/%i/mix/on", "/fxrtn/%02d/mix/on"} // État on/off d'un retour FX sur main.
FXBUSMUTE = {"/rtn/%i/mix/on", "/fxrtn/%02d/mix/%02d/on"} // État on/off d'un retour FX vers un bus : source = retour FX, destination = bus.
CHBUSMUTE = {"/ch/%02d/mix/on", "/ch/%02d/mix/%02d/on"} // État on/off d'un channel. Sur XAIR : un seul paramètre = numéro du channel ; le mute coupe le channel sur main et tous les bus, sans destination spécifique. Sur X32 : source = channel, destination = bus.
BUSMUTE = {"/bus/%i/mix/on", "/bus/%02d/mix/on"} // État on/off d'un bus / retour / monitor.
AUXBUSMUTE = {"/rtn/aux/mix/on", "/auxin/%02d/mix/%02d/on"} // État on/off d'une entrée AUX vers un bus : source = AUX, destination = bus.
AUXMAINMUTE = {"/rtn/aux/mix/on", "/auxin/%02d/mix/on"} // État on/off d'une entrée AUX sur main.
CHMAINMUTE = {"/ch/%02d/mix/on", "/ch/%02d/mix/on"} // État on/off d'un channel sur main. Un seul paramètre = numéro du channel, pour XAIR comme pour X32.
CHEQMUTE = {"/ch/%02d/eq/on", "/ch/%02d/eq/on"} // État on/off de l'EQ d'un channel.
BUSEQMUTE = {"/bus/%d/eq/on", "/bus/%02d/eq/on"} // État on/off de l'EQ d'un bus.
DCAMUTE = {"/dca/%d/on", "/dca/%d/on"} // État on/off d'un groupe DCA.

USBFNAME = {"/-stat/usb/%03d/name", "/-usb/dir/%03d/name"} // Nom d'un fichier ou dossier USB à l'index indiqué.
USBFTYPE = {"/-stat/usb/%03d/type", "/-usb/dir/%03d/type"} // Type d'une entrée USB à l'index indiqué.
USBMOUNTED = {"/-stat/usbmounted", "/-stat/usbmounted"} // État de montage du périphérique USB.
USBPATH = {"/-stat/usb/path", "/-usb/path"} // Chemin courant du navigateur USB.
USBSELECT = {"", "/-action/recselect"} // Sélection d'une entrée USB ou changement de répertoire USB. Non disponible ici côté XAIR.
USBCOUNT = {"/-stat/usb/count", "/-usb/dir/maxpos"} // Nombre d'entrées disponibles dans le répertoire USB courant.
TAPESTATE = {"/-stat/tape/state", "/-stat/tape/state"} // État du lecteur/enregistreur USB/tape.
TAPERTIME = {"/-stat/tape/rtime", "/-stat/tape/rtime"} // Temps restant du lecteur USB/tape.
TAPEETIME = {"/-stat/tape/etime", "/-stat/tape/etime"} // Temps écoulé du lecteur USB/tape.
TAPEFILE = {"/-stat/tape/file", "/-usb/title"} // Nom ou titre du fichier USB/tape courant.
USBFILEINDEX = {"", "/-usb/dir/dirpos"} // Index courant dans le répertoire USB. Non disponible ici côté XAIR.

SNAPNAME = {"/-snap/%02d/name", "/-show/showfile/scene/%03d/name"} // Nom d'un snapshot / d'une scène à l'index indiqué.
CURRENTSNAPNAME = {"/-snapstore/name", "/-show/showfile/show/name"} // Nom du snapshot/show courant.
SNAPINDEX = {"/-snap/index", "/-show/prepos/current"} // Index courant du snapshot / de la scène sélectionnée.
SNAPLOAD = {"/-snap/load", "/-action/goscene"} // Chargement d'un snapshot / d'une scène depuis son index.
SNAPSAVE = {"/-snap/save", "/save"} // Sauvegarde d'un snapshot / d'une scène.

LRNAME = {"/lr/config/name", "/main/st/config/name"} // Nom du main LR.
FXNAME = {"/rtn/%d/config/name", "/fxrtn/%02d/config/name"} // Nom d'un retour FX.
AUXNAME = {"/rtn/aux/config/name", "/auxin/%02d/config/name"} // Nom d'une entrée AUX.
CHNAME = {"/ch/%02d/config/name", "/ch/%02d/config/name"} // Nom d'un channel.
BUSNAME = {"/bus/%d/config/name", "/bus/%02d/config/name"} // Nom d'un bus / retour / monitor.
DCANAME = {"/dca/%d/config/name", "/dca/%d/config/name"} // Nom d'un groupe DCA.