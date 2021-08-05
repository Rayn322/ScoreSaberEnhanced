// ==UserScript==
// @name         ScoreSaberEnhanced
// @version      1.10.1
// @description  Adds links to beatsaver, player comparison and various other improvements
// @author       Splamy, TheAsuro
// @namespace    https://scoresaber.com
// @match        http://scoresaber.com/*
// @match        https://scoresaber.com/*
// @icon         https://scoresaber.com/imports/images/logo.ico
// @updateURL    https://github.com/Splamy/ScoreSaberEnhanced/raw/master/scoresaber.user.js
// @downloadURL  https://github.com/Splamy/ScoreSaberEnhanced/raw/master/scoresaber.user.js
// @require      https://cdn.jsdelivr.net/npm/moment@2.24.0/moment.js
// @run-at       document-start
// for Tampermonkey
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_info
// for Greasemonkey
// @grant        GM.xmlHttpRequest
// @connect      unpkg.com
// @connect      beatsaver.com
// @connect      githubusercontent.com
// @connect      bsaber.com
// ==/UserScript==

(function () {
    'use strict';

    class Global {
    }
    Global.debug = false;
    Global.scoresaber_link = "https://scoresaber.com";
    Global.beatsaver_link = "https://beatsaver.com/maps/";
    Global.bsaber_songs_link = "https://bsaber.com/songs/";
    Global.song_hash_reg = /\/([\da-zA-Z]{40})\.png/;
    Global.score_reg = /(score|accuracy):\s*([\d.,]+)%?\s*(\(([\w,]*)\))?/;
    Global.leaderboard_reg = /leaderboard\/(\d+)/;
    Global.leaderboard_rank_reg = /#([\d,]+)/;
    Global.leaderboard_country_reg = /(\?|&)country=(\w+)$/;
    Global.user_reg = /u\/(\d+)/;
    Global.script_version_reg = /\/\/\s*@version\s+([\d.]+)/;
    Global.user_per_page_global_leaderboard = 50;
    Global.user_per_page_song_leaderboard = 12;
    Global.pp_weighting_factor = 0.965;

    function create(tag, attrs, ...children) {
        if (tag === undefined)
            throw new Error("'tag' not defined");
        const ele = document.createElement(tag);
        if (attrs) {
            for (const [attrName, attrValue] of Object.entries(attrs)) {
                if (attrName === "style") {
                    for (const [styleName, styleValue] of Object.entries(attrs.style)) {
                        ele.style[styleName] = styleValue;
                    }
                }
                else if (attrName === "class") {
                    if (typeof attrs.class === "string") {
                        const classes = attrs.class.split(/ /g).filter(c => c.trim().length > 0);
                        ele.classList.add(...classes);
                    }
                    else {
                        ele.classList.add(...attrs.class);
                    }
                }
                else if (attrName === "for") {
                    ele.htmlFor = attrValue;
                }
                else if (attrName === "selected") {
                    ele.selected = (attrValue ? "selected" : undefined);
                }
                else if (attrName === "disabled") {
                    if (attrValue)
                        ele.setAttribute("disabled", undefined);
                }
                else if (attrName === "data") {
                    const data_dict = attrs[attrName];
                    for (const [data_key, data_value] of Object.entries(data_dict)) {
                        ele.dataset[data_key] = data_value;
                    }
                }
                else {
                    ele[attrName] = attrs[attrName];
                }
            }
        }
        into(ele, ...children);
        return ele;
    }
    function clear_children(elem) {
        while (elem.lastChild) {
            elem.removeChild(elem.lastChild);
        }
    }
    function intor(parent, ...children) {
        clear_children(parent);
        return into(parent, ...children);
    }
    function into(parent, ...children) {
        for (const child of children) {
            if (typeof child === "string") {
                if (children.length > 1) {
                    parent.appendChild(to_node(child));
                }
                else {
                    parent.textContent = child;
                }
            }
            else if ("then" in child) {
                const dummy = document.createElement("DIV");
                parent.appendChild(dummy);
                (async () => {
                    const node = await child;
                    parent.replaceChild(to_node(node), dummy);
                })();
            }
            else {
                parent.appendChild(child);
            }
        }
        return parent;
    }
    function to_node(elem) {
        if (typeof elem === "string") {
            const text_div = document.createElement("DIV");
            text_div.textContent = elem;
            return text_div;
        }
        return elem;
    }
    function as_fragment(builder) {
        const frag = document.createDocumentFragment();
        builder(frag);
        return frag;
    }

    function check(elem) {
        if (elem === undefined || elem === null) {
            throw new Error("Expected value to not be null");
        }
        return elem;
    }

    function get_user_header() {
        return check(document.querySelector(".content div.columns h5"));
    }
    function get_navbar() {
        return check(document.querySelector("#navMenu div.navbar-start"));
    }
    function is_user_page() {
        return window.location.href.toLowerCase().startsWith(Global.scoresaber_link + "/u/");
    }
    function is_song_leaderboard_page() {
        return window.location.href.toLowerCase().startsWith(Global.scoresaber_link + "/leaderboard/");
    }
    function get_current_user() {
        if (Global._current_user) {
            return Global._current_user;
        }
        if (!is_user_page()) {
            throw new Error("Not on a user page");
        }
        Global._current_user = get_document_user(document);
        return Global._current_user;
    }
    function get_document_user(doc) {
        const username_elem = check(doc.querySelector(".content .title a"));
        const user_name = username_elem.innerText.trim();
        const user_id = Global.user_reg.exec(window.location.href)[1];
        return { id: user_id, name: user_name };
    }
    function get_home_user() {
        if (Global._home_user) {
            return Global._home_user;
        }
        const json = localStorage.getItem("home_user");
        if (!json) {
            return undefined;
        }
        Global._home_user = JSON.parse(json);
        return Global._home_user;
    }
    function get_compare_user() {
        if (Global.last_selected) {
            return Global.last_selected;
        }
        const stored_last = localStorage.getItem("last_selected");
        if (stored_last) {
            Global.last_selected = stored_last;
            return Global.last_selected;
        }
        const compare = document.getElementById("user_compare");
        if (compare === null || compare === void 0 ? void 0 : compare.value) {
            Global.last_selected = compare.value;
            return Global.last_selected;
        }
        return undefined;
    }
    function insert_compare_feature(elem) {
        if (!is_user_page()) {
            throw Error("Invalid call to 'insert_compare_feature'");
        }
        setup_compare_feature_list();
        elem.style.marginLeft = "1em";
        into(check(Global.feature_list), elem);
    }
    function insert_compare_display(elem) {
        if (!is_user_page()) {
            throw Error("Invalid call to 'insert_compare_display'");
        }
        setup_compare_feature_list();
        into(check(Global.feature_display_list), elem);
    }
    function setup_compare_feature_list() {
        if (Global.feature_list === undefined) {
            const select_score_order_elem = check(document.querySelector(".content div.select"));
            const parent_box_elem = check(select_score_order_elem.parentElement);
            Global.feature_list = create("div", { class: "level-item" });
            const level_box_elem = create("div", { class: "level" }, Global.feature_list);
            parent_box_elem.replaceChild(level_box_elem, select_score_order_elem);
            insert_compare_feature(select_score_order_elem);
            Global.feature_display_list = create("div", { class: "level-item" });
            level_box_elem.insertAdjacentElement("afterend", Global.feature_display_list);
        }
    }
    function set_compare_user(user) {
        Global.last_selected = user;
        localStorage.setItem("last_selected", user);
    }
    function set_home_user(user) {
        Global._home_user = user;
        localStorage.setItem("home_user", JSON.stringify(user));
    }
    function set_wide_table(value) {
        localStorage.setItem("wide_song_table", value ? "true" : "false");
    }
    function get_wide_table() {
        return localStorage.getItem("wide_song_table") === "true";
    }
    const BMPage = ["song", "songlist", "user"];
    const BMButton = ["BS", "OC", "Beast", "BeastBook", "Preview", "BSR"];
    const BMPageButtons = BMPage
        .map(p => BMButton.map(b => `${p}-${b}`))
        .reduce((agg, lis) => [...agg, ...lis], []);
    const BMButtonHelp = {
        BS: { short: "BS", long: "BeatSaver", tip: "View on BeatSaver" },
        OC: { short: "OC", long: "OneClick™", tip: "Download with OneClick™" },
        Beast: { short: "BST", long: "BeastSaber", tip: "View/Add rating on BeastSaber" },
        BeastBook: { short: "BB", long: "BeastSaber Bookmark", tip: "Bookmark on BeastSaber" },
        Preview: { short: "👓", long: "Preview", tip: "Preview map" },
        BSR: { short: "❗", long: "BeatSaver Request", tip: "Copy !bsr" },
    };
    function bmvar(page, button, def) {
        return {
            display: `var(--sse-show-${page}-${button}, ${def})`,
        };
    }
    function get_button_matrix() {
        const json = localStorage.getItem("sse_button_matrix");
        if (!json)
            return default_button_matrix();
        return JSON.parse(json);
    }
    function default_button_matrix() {
        return {
            "song-BS": true,
            "song-BSR": true,
            "song-Beast": true,
            "song-BeastBook": true,
            "song-OC": true,
            "song-Preview": true,
            "songlist-BS": true,
            "songlist-OC": true,
            "user-BS": true,
            "user-OC": true,
        };
    }
    function set_button_matrix(bm) {
        localStorage.setItem("sse_button_matrix", JSON.stringify(bm));
    }
    function set_use_new_ss_api(value) {
        localStorage.setItem("use_new_api", value ? "true" : "false");
    }
    function get_use_new_ss_api() {
        return (localStorage.getItem("use_new_api") || "true") === "true";
    }
    function set_bsaber_username(value) {
        localStorage.setItem("bsaber_username", value);
    }
    function get_bsaber_username() {
        return (localStorage.getItem("bsaber_username") || undefined);
    }
    function get_bsaber_bookmarks() {
        const data = localStorage.getItem("bsaber_bookmarks");
        if (!data)
            return [];
        return JSON.parse(data);
    }
    function add_bsaber_bookmark(song_hash) {
        const bookmarks = get_bsaber_bookmarks();
        bookmarks.push(song_hash);
        localStorage.setItem("bsaber_bookmarks", JSON.stringify(bookmarks));
    }
    function check_bsaber_bookmark(song_hash) {
        const bookmarks = get_bsaber_bookmarks();
        return bookmarks.includes(song_hash.toLowerCase());
    }

    function format_en(num, digits) {
        if (digits === undefined)
            digits = 2;
        return num.toLocaleString("en", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    function toggled_class(bool, css_class) {
        return bool ? css_class : "";
    }
    function number_invariant(num) {
        return Number(num.replace(/,/g, ""));
    }
    function number_to_timespan(num) {
        const SECONDS_IN_MINUTE = 60;
        const MINUTES_IN_HOUR = 60;
        let str = "";
        let mod = (num % SECONDS_IN_MINUTE);
        str = mod.toFixed(0).padStart(2, "0") + str;
        num = (num - mod) / SECONDS_IN_MINUTE;
        mod = (num % MINUTES_IN_HOUR);
        str = mod.toFixed(0).padStart(2, "0") + ":" + str;
        num = (num - mod) / MINUTES_IN_HOUR;
        return str;
    }
    function round2(num) {
        return Math.round(num * 100) / 100;
    }
    function read_inline_date(date) {
        return moment.utc(date, "YYYY-MM-DD HH:mm:ss UTC");
    }

    class Limiter {
        constructor() {
            this.ratelimit_reset = undefined;
            this.ratelimit_remaining = undefined;
        }
        async wait() {
            const now = unix_timestamp();
            if (this.ratelimit_reset === undefined || now > this.ratelimit_reset) {
                this.ratelimit_reset = undefined;
                this.ratelimit_remaining = undefined;
                return;
            }
            if (this.ratelimit_remaining === 0) {
                const sleepTime = (this.ratelimit_reset - now);
                console.log(`Waiting for cloudflare rate limiter... ${sleepTime}sec`);
                await sleep(sleepTime * 1000);
                this.ratelimit_remaining = this.ratelimit_limit;
                this.ratelimit_reset = undefined;
            }
        }
        setLimitData(remaining, reset, limit) {
            this.ratelimit_remaining = remaining;
            this.ratelimit_reset = reset;
            this.ratelimit_limit = limit;
        }
    }
    async function sleep(timeout) {
        return new Promise(resolve => setTimeout(resolve, timeout));
    }
    function unix_timestamp() {
        return Math.round((new Date()).getTime() / 1000);
    }

    function setup$3() {
        Global.debug = localStorage.getItem("debug") === "true";
    }
    function logc(message, ...optionalParams) {
        if (Global.debug) {
            console.log("DBG", message, ...optionalParams);
        }
    }

    let SSE_addStyle;
    let SSE_xmlhttpRequest;
    let SSE_info;
    function setup$2() {
        if (typeof (GM) !== "undefined") {
            logc("Using GM.* extenstions", GM);
            SSE_addStyle = GM_addStyle_custom;
            SSE_xmlhttpRequest = GM.xmlHttpRequest;
            SSE_info = GM.info;
        }
        else {
            logc("Using GM_ extenstions");
            SSE_addStyle = GM_addStyle;
            SSE_xmlhttpRequest = GM_xmlhttpRequest;
            SSE_info = GM_info;
        }
    }
    function GM_addStyle_custom(css) {
        const style = create("style");
        style.innerHTML = css;
        into(document.head, style);
        return style;
    }
    async function load_chart_lib() {
        if (typeof Chart !== "function") {
            try {
                const resp = await fetch("https://scoresaber.com/imports/js/chart.js");
                const js = await resp.text();
                new Function(js)();
            }
            catch (err) {
                console.warn("Failed to fetch chartjs. Charts might not work", err);
                return false;
            }
        }
        return true;
    }

    function fetch2(url) {
        return new Promise((resolve, reject) => {
            const host = get_hostname(url);
            const request_param = {
                method: "GET",
                url: url,
                headers: { Origin: host },
                onload: (req) => {
                    if (req.status >= 200 && req.status < 300) {
                        resolve(req.responseText);
                    }
                    else {
                        reject(`request errored: ${url} (${req.status})`);
                    }
                },
                onerror: () => {
                    reject(`request errored: ${url}`);
                }
            };
            SSE_xmlhttpRequest(request_param);
        });
    }
    function get_hostname(url) {
        const match = url.match(/:\/\/([^/:]+)/i);
        if (match !== null) {
            return match[1];
        }
        else {
            return undefined;
        }
    }

    class SessionCache {
        constructor(prefix) {
            this.prefix = prefix;
            if (prefix === undefined)
                throw Error("Prefix must be set. If you don't want a prefix, explicitely pass ''.");
        }
        get(key) {
            const item = sessionStorage.getItem(this.prefix + key);
            if (item === null)
                return undefined;
            return JSON.parse(item);
        }
        set(key, value) {
            sessionStorage.setItem(this.prefix + key, JSON.stringify(value));
        }
    }

    const api_cache$1 = new SessionCache("saver");
    async function get_data_by_hash(song_hash) {
        const cached_data = api_cache$1.get(song_hash);
        if (cached_data !== undefined)
            return cached_data;
        try {
            const data_str = await fetch2(`https://api.beatsaver.com/maps/hash/${song_hash}`);
            const data = JSON.parse(data_str);
            api_cache$1.set(song_hash, data);
            return data;
        }
        catch (err) {
            logc("Failed to download song data", err);
            return undefined;
        }
    }

    class Modal {
        constructor(elem) {
            this.elem = elem;
        }
        show() {
            this.elem.classList.add("is-active");
            document.documentElement.classList.add("is-clipped");
        }
        close(answer) {
            this.elem.classList.remove("is-active");
            if (!document.querySelector(".modal.is-active"))
                document.documentElement.classList.remove("is-clipped");
            if (this.after_close)
                this.after_close(answer !== null && answer !== void 0 ? answer : "x");
        }
        dispose() {
            document.body.removeChild(this.elem);
        }
    }
    function create_modal(opt) {
        var _a, _b, _c, _d;
        const base_div = create("div", { class: "modal" });
        const modal = new Modal(base_div);
        const button_bar = create("div", { class: "buttons" });
        let inner;
        switch ((_a = opt.type) !== null && _a !== void 0 ? _a : "content") {
            case "content":
                inner = create("div", { class: "modal-content" }, create("div", { class: "box" }, opt.text, create("br"), button_bar));
                break;
            case "card":
                inner = create("div", { class: "modal-card" }, create("header", { class: "modal-card-head" }, (_b = opt.title) !== null && _b !== void 0 ? _b : ""), create("section", { class: "modal-card-body" }, opt.text), create("footer", { class: "modal-card-foot" }, (_c = opt.footer) !== null && _c !== void 0 ? _c : button_bar));
                break;
            default:
                throw new Error("invalid type");
        }
        into(base_div, create("div", {
            class: "modal-background",
            onclick() {
                modal.close("x");
            }
        }), inner, create("button", {
            class: "modal-close is-large",
            onclick() {
                modal.close("x");
            }
        }));
        if (opt.buttons) {
            for (const btn_name of Object.keys(opt.buttons)) {
                const btn_data = opt.buttons[btn_name];
                into(button_bar, create("button", {
                    class: ["button", (_d = btn_data.class) !== null && _d !== void 0 ? _d : ""],
                    onclick() {
                        modal.close(btn_name);
                    }
                }, btn_data.text));
            }
        }
        document.body.appendChild(base_div);
        if (opt.default)
            modal.show();
        return modal;
    }
    function show_modal(opt) {
        return new Promise((resolve) => {
            opt.default = true;
            const modal = create_modal(opt);
            modal.after_close = (answer) => {
                modal.dispose();
                resolve(answer);
            };
        });
    }
    const buttons = {
        OkOnly: { x: { text: "Ok", class: "is-primary" } },
    };

    function get_song_compare_value(song_a, song_b) {
        if (song_a.pp > 0 || song_b.pp > 0) {
            return [song_a.pp, song_b.pp];
        }
        else if (song_a.score !== undefined && song_b.score !== undefined) {
            return [song_a.score, song_b.score];
        }
        else if (song_a.accuracy !== undefined && song_b.accuracy !== undefined) {
            return [song_a.accuracy * get_song_mod_multiplier(song_a), song_b.accuracy * get_song_mod_multiplier(song_b)];
        }
        else {
            return [-1, -1];
        }
    }
    function get_song_mod_multiplier(song) {
        if (!song.mods)
            return 1.0;
        let multiplier = 1.0;
        for (const mod of song.mods) {
            switch (mod) {
                case "NF":
                    multiplier -= 0.50;
                    break;
                case "NO":
                    multiplier -= 0.05;
                    break;
                case "NB":
                    multiplier -= 0.10;
                    break;
                case "SS":
                    multiplier -= 0.30;
                    break;
                case "NA":
                    multiplier -= 0.30;
                    break;
                case "DA":
                    multiplier += 0.07;
                    break;
                case "GN":
                    multiplier += 0.11;
                    break;
                case "FS":
                    multiplier += 0.08;
                    break;
            }
        }
        return Math.max(0, multiplier);
    }
    function get_song_hash_from_text(text) {
        const res = Global.song_hash_reg.exec(text);
        return res ? res[1] : undefined;
    }
    async function oneclick_install(song_key) {
        const lastCheck = localStorage.getItem("oneclick-prompt");
        const prompt = !lastCheck ||
            new Date(lastCheck).getTime() + (1000 * 60 * 60 * 24 * 31) < new Date().getTime();
        if (prompt) {
            localStorage.setItem("oneclick-prompt", new Date().getTime().toString());
            const resp = await show_modal({
                buttons: {
                    install: { text: "Get ModAssistant Installer", class: "is-info" },
                    done: { text: "OK, now leave me alone", class: "is-success" },
                },
                text: "OneClick™ requires any current ModInstaller tool with the OneClick™ feature enabled.\nMake sure you have one installed before proceeding.",
            });
            if (resp === "install") {
                window.open("https://github.com/Assistant/ModAssistant/releases");
                return;
            }
        }
        console.log("Downloading: ", song_key);
        window.location.assign(`beatsaver://${song_key}`);
    }
    function song_equals(a, b) {
        if (a === b)
            return true;
        if (a === undefined || b === undefined)
            return false;
        return (a.accuracy === b.accuracy &&
            a.pp === b.pp &&
            a.score === b.score &&
            a.time === b.time &&
            array_equals(a.mods, b.mods));
    }
    function array_equals(a, b) {
        if (a === b)
            return true;
        if (a === undefined || b === undefined)
            return false;
        if (a.length !== b.length)
            return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i])
                return false;
        }
        return true;
    }
    function parse_mods(mods) {
        if (!mods)
            return undefined;
        const modarr = mods.split(/,/g);
        if (modarr.length === 0)
            return undefined;
        return modarr;
    }
    function parse_score_bottom(text) {
        let score = undefined;
        let accuracy = undefined;
        let mods = undefined;
        const score_res = check(Global.score_reg.exec(text));
        if (score_res[1] === "score") {
            score = number_invariant(score_res[2]);
        }
        else if (score_res[1] === "accuracy") {
            accuracy = Number(score_res[2]);
        }
        if (score_res[4]) {
            mods = parse_mods(score_res[4]);
        }
        return { score, accuracy, mods };
    }
    function get_notes_count(diff_name, characteristic) {
        var _a;
        let diff;
        switch (diff_name) {
            case "Easy":
                diff = characteristic.difficulties.easy;
                break;
            case "Normal":
                diff = characteristic.difficulties.normal;
                break;
            case "Hard":
                diff = characteristic.difficulties.hard;
                break;
            case "Expert":
                diff = characteristic.difficulties.expert;
                break;
            case "Expert+":
                diff = characteristic.difficulties.expertPlus;
                break;
        }
        return (_a = diff === null || diff === void 0 ? void 0 : diff.notes) !== null && _a !== void 0 ? _a : -1;
    }
    function calculate_max_score(notes) {
        const note_score = 115;
        if (notes <= 1)
            return note_score * (0 + (notes - 0) * 1);
        if (notes <= 5)
            return note_score * (1 + (notes - 1) * 2);
        if (notes <= 13)
            return note_score * (9 + (notes - 5) * 4);
        return note_score * (41 + (notes - 13) * 8);
    }

    const SCORESABER_LINK = "https://new.scoresaber.com/api";
    const API_LIMITER = new Limiter();
    async function get_user_recent_songs_dynamic(user_id, page) {
        logc(`Fetching user ${user_id} page ${page}`);
        if (get_use_new_ss_api()) {
            return get_user_recent_songs_new_api_wrap(user_id, page);
        }
        else {
            return get_user_recent_songs_old_api_wrap(user_id, page);
        }
    }
    async function get_user_recent_songs_new_api_wrap(user_id, page) {
        const recent_songs = await get_user_recent_songs(user_id, page);
        if (!recent_songs) {
            return {
                meta: { was_last_page: true },
                songs: []
            };
        }
        return {
            meta: {
                was_last_page: recent_songs.scores.length < 8
            },
            songs: recent_songs.scores.map(s => [String(s.leaderboardId), {
                    time: s.timeSet,
                    pp: s.pp,
                    accuracy: s.maxScore !== 0 ? round2((s.unmodififiedScore / s.maxScore) * 100) : undefined,
                    score: s.score,
                    mods: parse_mods(s.mods)
                }])
        };
    }
    async function get_user_recent_songs(user_id, page) {
        const req = await auto_fetch_retry(`${SCORESABER_LINK}/player/${user_id}/scores/recent/${page}`);
        if (req.status === 404) {
            return null;
        }
        const data = await req.json();
        return sanitize_song_ids(data);
    }
    async function get_user_info_basic(user_id) {
        const req = await auto_fetch_retry(`${SCORESABER_LINK}/player/${user_id}/basic`);
        const data = await req.json();
        return sanitize_player_ids(data);
    }
    async function auto_fetch_retry(url) {
        const MAX_RETRIES = 20;
        const SLEEP_WAIT = 5000;
        for (let retries = MAX_RETRIES; retries >= 0; retries--) {
            await API_LIMITER.wait();
            const response = await fetch(url);
            const remaining = Number(response.headers.get("x-ratelimit-remaining"));
            const reset = Number(response.headers.get("x-ratelimit-reset"));
            const limit = Number(response.headers.get("x-ratelimit-limit"));
            API_LIMITER.setLimitData(remaining, reset, limit);
            if (response.status === 429) {
                await sleep(SLEEP_WAIT);
            }
            else {
                return response;
            }
        }
        throw new Error("Can't fetch data from new.scoresaber.");
    }
    function sanitize_player_ids(data) {
        data.playerInfo.playerId = String(data.playerInfo.playerId);
        return data;
    }
    function sanitize_song_ids(data) {
        for (const s of data.scores) {
            s.scoreId = String(s.scoreId);
            s.leaderboardId = String(s.leaderboardId);
            s.playerId = String(s.playerId);
        }
        return data;
    }
    async function get_user_recent_songs_old_api_wrap(user_id, page) {
        let doc;
        let tries = 5;
        while ((!doc || doc.body.textContent === '"Rate Limit Exceeded"') && tries > 0) {
            await sleep(500);
            doc = await fetch_user_page(user_id, page);
            tries--;
        }
        if (doc === undefined) {
            throw Error("Error fetching user page");
        }
        const last_page_elem = doc.querySelector("nav ul.pagination-list li:last-child a");
        const max_pages = Number(last_page_elem.innerText) + 1;
        const data = {
            meta: {
                max_pages,
                user_name: get_document_user(doc).name,
                was_last_page: page === max_pages,
            },
            songs: [],
        };
        const table_row = doc.querySelectorAll("table.ranking.songs tbody tr");
        for (const row of table_row) {
            const song_data = get_row_data(row);
            data.songs.push(song_data);
        }
        return data;
    }
    async function fetch_user_page(user_id, page) {
        const link = Global.scoresaber_link + `/u/${user_id}&page=${page}&sort=2`;
        if (window.location.href.toLowerCase() === link) {
            logc("Efficient get :P");
            return document;
        }
        const init_fetch = await (await fetch(link)).text();
        const parser = new DOMParser();
        return parser.parseFromString(init_fetch, "text/html");
    }
    function get_row_data(row) {
        const rowc = row;
        if (rowc.cache) {
            return rowc.cache;
        }
        const leaderboard_elem = check(row.querySelector("th.song a"));
        const pp_elem = check(row.querySelector("th.score .ppValue"));
        const score_elem = check(row.querySelector("th.score .scoreBottom"));
        const time_elem = check(row.querySelector("th.song .time"));
        const song_id = Global.leaderboard_reg.exec(leaderboard_elem.href)[1];
        const pp = Number(pp_elem.innerText);
        const time = read_inline_date(time_elem.title).toISOString();
        const { score, accuracy, mods } = parse_score_bottom(score_elem.innerText);
        const song = {
            pp,
            time,
            score,
            accuracy,
            mods,
        };
        const data = [song_id, song];
        rowc.cache = data;
        return data;
    }

    class SseEventHandler {
        constructor(eventName) {
            this.eventName = eventName;
            this.callList = [];
        }
        invoke(param) {
            logc("Event", this.eventName);
            for (const func of this.callList) {
                func(param);
            }
        }
        register(func) {
            this.callList.push(func);
        }
    }
    class SseEvent {
        static addNotification(notify) {
            this.notificationList.push(notify);
            SseEvent.UserNotification.invoke();
        }
        static getNotifications() {
            return this.notificationList;
        }
    }
    SseEvent.UserCacheChanged = new SseEventHandler("UserCacheChanged");
    SseEvent.CompareUserChanged = new SseEventHandler("CompareUserChanged");
    SseEvent.PinnedUserChanged = new SseEventHandler("PinnedUserChanged");
    SseEvent.UserNotification = new SseEventHandler("UserNotification");
    SseEvent.StatusInfo = new SseEventHandler("StatusInfo");
    SseEvent.notificationList = [];

    const CURRENT_DATA_VER = 1;
    function load() {
        const json = localStorage.getItem("users");
        if (!json) {
            reset_data();
            return;
        }
        try {
            Global.user_list = JSON.parse(json);
        }
        catch (ex) {
            console.error("Failed to read user cache, resetting!");
            reset_data();
            return;
        }
        let users_data_ver = get_data_ver();
        if (users_data_ver !== CURRENT_DATA_VER) {
            logc("Updating usercache format");
            if (users_data_ver <= 0) {
                for (const user of Object.values(Global.user_list)) {
                    for (const song of Object.values(user.songs)) {
                        const time = read_inline_date(song.time);
                        song.time = time.toISOString();
                    }
                }
                users_data_ver = 1;
            }
            update_data_ver();
            save();
            logc("Update successful");
        }
        logc("Loaded usercache", Global.user_list);
    }
    function reset_data() {
        Global.user_list = {};
        localStorage.setItem("users", "{}");
        update_data_ver();
    }
    function get_data_ver() {
        var _a;
        return Number((_a = localStorage.getItem("users_data_ver")) !== null && _a !== void 0 ? _a : "0");
    }
    function update_data_ver() {
        localStorage.setItem("users_data_ver", String(CURRENT_DATA_VER));
    }
    function save() {
        localStorage.setItem("users", JSON.stringify(Global.user_list));
    }

    function setup_user_compare() {
        if (!is_user_page()) {
            return;
        }
        const header = get_user_header();
        header.style.display = "flex";
        header.style.alignItems = "center";
        const user = get_current_user();
        into(header, create("div", {
            class: "button icon is-medium",
            style: { cursor: "pointer" },
            data: { tooltip: Global.user_list[user.id] ? "Update score cache" : "Add user to your score cache" },
            async onclick() {
                await fetch_user(get_current_user().id);
            },
        }, create("i", { class: ["fas", Global.user_list[user.id] ? "fa-sync" : "fa-bookmark"] })));
        const status_elem = create("div");
        into(header, status_elem);
        SseEvent.StatusInfo.register((status) => intor(status_elem, status.text));
        Global.users_elem = create("div");
        insert_compare_feature(Global.users_elem);
        update_user_compare_dropdown();
        SseEvent.UserCacheChanged.register(update_user_compare_dropdown);
        SseEvent.UserCacheChanged.register(update_user_compare_songtable);
        SseEvent.CompareUserChanged.register(update_user_compare_songtable);
        SseEvent.CompareUserChanged.invoke();
    }
    function update_user_compare_dropdown() {
        if (!is_user_page()) {
            return;
        }
        const compare = get_compare_user();
        intor(Global.users_elem, create("div", { class: "select" }, create("select", {
            id: "user_compare",
            onchange() {
                const user = this.value;
                set_compare_user(user);
                SseEvent.CompareUserChanged.invoke();
            }
        }, create("option", { value: undefined, selected: compare === undefined }, "(None)"), ...Object.entries(Global.user_list).map(([id, user]) => {
            return create("option", { value: id, selected: compare === id }, user.name);
        }))));
    }
    function update_user_compare_songtable(other_user) {
        var _a;
        if (!is_user_page()) {
            return;
        }
        const table = check(document.querySelector("table.ranking.songs"));
        const table_row = table.querySelectorAll("tbody tr");
        const scoreHeader = check(table.querySelector("tr th.score"));
        scoreHeader.textContent = "Score";
        table.querySelectorAll(".comparisonScore").forEach(el => el.remove());
        table_row.forEach(row => row.style.backgroundImage = "unset");
        if (other_user === undefined) {
            other_user = get_compare_user();
            if (other_user === undefined) {
                return;
            }
        }
        const other_data = Global.user_list[other_user];
        if (!other_data) {
            logc("Other user not found: ", other_user);
            return;
        }
        const ranking_table_header = check(table.querySelector("thead > tr"));
        const scoreCompareHeader = create("th", { class: "comparisonScore" }, other_data.name);
        check(ranking_table_header.querySelector(".score")).insertAdjacentElement("afterend", scoreCompareHeader);
        const isSameCompare = other_user === get_current_user().id;
        const isSelfCompare = isSameCompare && other_user === ((_a = get_home_user()) === null || _a === void 0 ? void 0 : _a.id);
        if (isSelfCompare) {
            scoreHeader.textContent = "You (now)";
            scoreCompareHeader.textContent = "You (last cache)";
        }
        else if (isSameCompare) {
            scoreHeader.textContent = `${other_data.name} (now)`;
            scoreCompareHeader.textContent = "(last cache)";
        }
        else {
            scoreHeader.textContent = get_current_user().name;
        }
        for (const row of table_row) {
            const [song_id, song] = get_row_data(row);
            const other_song = other_data.songs[song_id];
            let other_score_content;
            if (other_song) {
                other_score_content = [
                    create("span", { class: "scoreTop ppValue" }, format_en(other_song.pp)),
                    create("span", { class: "scoreTop ppLabel" }, "pp"),
                    create("br"),
                    (() => {
                        let str;
                        if (other_song.accuracy !== undefined) {
                            str = `accuracy: ${format_en(other_song.accuracy)}%`;
                        }
                        else if (other_song.score !== undefined) {
                            str = `score: ${format_en(other_song.score)}`;
                        }
                        else {
                            return "<No Data>";
                        }
                        if (other_song.mods !== undefined) {
                            str += ` (${other_song.mods.join(",")})`;
                        }
                        return create("span", { class: "scoreBottom" }, str);
                    })()
                ];
            }
            else {
                other_score_content = [create("hr", {})];
            }
            check(row.querySelector(".score")).insertAdjacentElement("afterend", create("th", { class: "comparisonScore" }, ...other_score_content));
            if (!other_song) {
                logc("No match");
                continue;
            }
            const [value1, value2] = get_song_compare_value(song, other_song);
            if (value1 === -1 && value2 === -1) {
                logc("No score");
                continue;
            }
            let value = (Math.min(value1, value2) / Math.max(value1, value2)) * 100;
            const better = value1 > value2;
            if (better) {
                value = 100 - value;
            }
            value = round2(value);
            if (better) {
                row.style.backgroundImage = `linear-gradient(75deg, var(--color-ahead) ${value}%, rgba(0,0,0,0) ${value}%)`;
            }
            else {
                row.style.backgroundImage = `linear-gradient(105deg, rgba(0,0,0,0) ${value}%, var(--color-behind) ${value}%)`;
            }
        }
    }
    async function fetch_user(user_id, force = false) {
        var _a, _b;
        let user = Global.user_list[user_id];
        if (!user) {
            user = {
                name: "User" + user_id,
                songs: {}
            };
            Global.user_list[user_id] = user;
        }
        let page_max = undefined;
        let user_name = user.name;
        let updated = false;
        SseEvent.StatusInfo.invoke({ text: `Fetching user ${user_name}` });
        if (get_use_new_ss_api()) {
            const user_data = await get_user_info_basic(user_id);
            user_name = user_data.playerInfo.playerName;
        }
        for (let page = 1;; page++) {
            SseEvent.StatusInfo.invoke({ text: `Updating user ${user_name} page ${page}/${(page_max !== null && page_max !== void 0 ? page_max : "?")}` });
            const recent_songs = await get_user_recent_songs_dynamic(user_id, page);
            const { has_old_entry, has_updated } = process_user_page(recent_songs.songs, user);
            updated = updated || has_updated;
            page_max = (_a = recent_songs.meta.max_pages) !== null && _a !== void 0 ? _a : page_max;
            user_name = (_b = recent_songs.meta.user_name) !== null && _b !== void 0 ? _b : user_name;
            if ((!force && has_old_entry) || recent_songs.meta.was_last_page) {
                break;
            }
        }
        user.name = user_name !== null && user_name !== void 0 ? user_name : user.name;
        if (updated) {
            save();
        }
        SseEvent.StatusInfo.invoke({ text: `User ${user_name} updated` });
        SseEvent.UserCacheChanged.invoke();
    }
    async function fetch_all(force = false) {
        const users = Object.keys(Global.user_list);
        for (const user of users) {
            await fetch_user(user, force);
        }
        SseEvent.StatusInfo.invoke({ text: `All users updated` });
    }
    function process_user_page(songs, user) {
        let has_old_entry = false;
        let has_updated = false;
        for (const [song_id, song] of songs) {
            const song_old = user.songs[song_id];
            if (!song_old || !song_equals(song_old, song)) {
                logc("Updated: ", song_old, song);
                has_updated = true;
            }
            else {
                logc("Old found: ", song);
                has_old_entry = true;
            }
            user.songs[song_id] = song;
        }
        return { has_old_entry, has_updated };
    }

    function setup_self_pin_button() {
        if (!is_user_page()) {
            return;
        }
        const header = get_user_header();
        into(header, create("div", {
            class: "button icon is-medium",
            style: { cursor: "pointer" },
            data: { tooltip: "Pin this user to your navigation bar" },
            onclick() {
                set_home_user(get_current_user());
                SseEvent.PinnedUserChanged.invoke();
            }
        }, create("i", { class: "fas fa-thumbtack" })));
    }
    function setup_self_button() {
        var _a;
        const home_user = (_a = get_home_user()) !== null && _a !== void 0 ? _a : { name: "<Pins>", id: "0" };
        into(get_navbar(), create("div", { class: "navbar-item has-dropdown is-hoverable" }, create("a", {
            id: "home_user",
            class: "navbar-item",
            href: Global.scoresaber_link + "/u/" + home_user.id
        }, home_user.name), create("div", {
            id: "home_user_list",
            class: "navbar-dropdown"
        })));
        update_self_user_list();
        SseEvent.UserCacheChanged.register(update_self_user_list);
        SseEvent.PinnedUserChanged.register(update_self_button);
    }
    function update_self_button() {
        var _a;
        const home_user = (_a = get_home_user()) !== null && _a !== void 0 ? _a : { name: "<Pins>", id: "0" };
        const home_elem = document.getElementById("home_user");
        if (home_elem) {
            home_elem.href = Global.scoresaber_link + "/u/" + home_user.id;
            home_elem.innerText = home_user.name;
        }
    }
    function update_self_user_list() {
        const home_user_list_elem = check(document.getElementById("home_user_list"));
        intor(home_user_list_elem, ...Object.entries(Global.user_list).map(([id, user]) => {
            return create("a", {
                class: "navbar-item",
                style: {
                    paddingRight: "1em",
                    flexWrap: "nowrap",
                    display: "flex",
                },
                href: Global.scoresaber_link + "/u/" + id,
            }, create("div", { style: { flex: "1" } }, user.name), create("div", {
                class: "button icon is-medium is-danger is-outlined",
                style: { marginLeft: "3em" },
                async onclick(ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const response = await show_modal({
                        text: `Delete User "${user.name}" from cache?`,
                        buttons: {
                            delete: { text: "Delete", class: "is-danger" },
                            x: { text: "Abort", class: "is-info" }
                        },
                    });
                    if (response === "delete") {
                        logc("Delete user", id, user.name);
                        delete_user(id);
                    }
                }
            }, create("i", { class: "fas fa-trash-alt" })));
        }));
    }
    function delete_user(user_id) {
        if (Global.user_list[user_id]) {
            delete Global.user_list[user_id];
            save();
            SseEvent.UserCacheChanged.invoke();
        }
    }

    function noop() { }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }
    function append(target, node) {
        target.appendChild(node);
    }
    function append_styles(target, style_sheet_id, styles) {
        const append_styles_to = get_root_for_style(target);
        if (!append_styles_to.getElementById(style_sheet_id)) {
            const style = element('style');
            style.id = style_sheet_id;
            style.textContent = styles;
            append_stylesheet(append_styles_to, style);
        }
    }
    function get_root_for_style(node) {
        if (!node)
            return document;
        const root = node.getRootNode ? node.getRootNode() : node.ownerDocument;
        if (root.host) {
            return root;
        }
        return document;
    }
    function append_stylesheet(node, style) {
        append(node.head || node, style);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function select_option(select, value) {
        for (let i = 0; i < select.options.length; i += 1) {
            const option = select.options[i];
            if (option.__value === value) {
                option.selected = true;
                return;
            }
        }
    }
    function select_value(select) {
        const selected_option = select.querySelector(':checked') || select.options[0];
        return selected_option && selected_option.__value;
    }
    function toggle_class(element, name, toggle) {
        element.classList[toggle ? 'add' : 'remove'](name);
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor, customElement) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        if (!customElement) {
            // onMount happens before the initial afterUpdate
            add_render_callback(() => {
                const new_on_destroy = on_mount.map(run).filter(is_function);
                if (on_destroy) {
                    on_destroy.push(...new_on_destroy);
                }
                else {
                    // Edge case - component was destroyed immediately,
                    // most likely as a result of a binding initialising
                    run_all(new_on_destroy);
                }
                component.$$.on_mount = [];
            });
        }
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            on_disconnect: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : options.context || []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false,
            root: options.target || parent_component.$$.root
        };
        append_styles && append_styles($$.root);
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor, options.customElement);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    /* src\components\QuickButton.svelte generated by Svelte v3.41.0 */

    function add_css(target) {
    	append_styles(target, "svelte-1so5nc2", "div.svelte-1so5nc2{padding:0;cursor:pointer}div.svelte-1so5nc2:disabled{cursor:default}.bsaber_bg.svelte-1so5nc2{background-image:url(\"https://bsaber.com/wp-content/themes/beastsaber-wp-theme/assets/img/avater-callback.png\");background-size:cover;background-repeat:no-repeat;background-position:center;width:100%;height:100%;border-radius:inherit}.dummy.svelte-1so5nc2{position:absolute;top:0px;left:-100000px}");
    }

    // (130:26) 
    function create_if_block_5(ctx) {
    	let i;
    	let t;
    	let input;

    	return {
    		c() {
    			i = element("i");
    			t = space();
    			input = element("input");
    			attr(i, "class", "fas fa-exclamation");
    			attr(input, "class", "dummy svelte-1so5nc2");
    		},
    		m(target, anchor) {
    			insert(target, i, anchor);
    			insert(target, t, anchor);
    			insert(target, input, anchor);
    			/*input_binding*/ ctx[11](input);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(i);
    			if (detaching) detach(t);
    			if (detaching) detach(input);
    			/*input_binding*/ ctx[11](null);
    		}
    	};
    }

    // (128:30) 
    function create_if_block_4(ctx) {
    	let i;

    	return {
    		c() {
    			i = element("i");
    			attr(i, "class", "fas fa-glasses");
    		},
    		m(target, anchor) {
    			insert(target, i, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(i);
    		}
    	};
    }

    // (126:32) 
    function create_if_block_3(ctx) {
    	let i;

    	return {
    		c() {
    			i = element("i");
    			attr(i, "class", "fas fa-thumbtack");
    		},
    		m(target, anchor) {
    			insert(target, i, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(i);
    		}
    	};
    }

    // (124:28) 
    function create_if_block_2(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			attr(div, "class", "bsaber_bg svelte-1so5nc2");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    // (122:25) 
    function create_if_block_1(ctx) {
    	let i;

    	return {
    		c() {
    			i = element("i");
    			attr(i, "class", "fas fa-cloud-download-alt");
    		},
    		m(target, anchor) {
    			insert(target, i, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(i);
    		}
    	};
    }

    // (120:1) {#if type === "BS"}
    function create_if_block(ctx) {
    	let div;

    	return {
    		c() {
    			div = element("div");
    			attr(div, "class", "beatsaver_bg svelte-1so5nc2");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    		},
    		p: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    		}
    	};
    }

    function create_fragment$1(ctx) {
    	let div;
    	let div_class_value;
    	let mounted;
    	let dispose;

    	function select_block_type(ctx, dirty) {
    		if (/*type*/ ctx[0] === "BS") return create_if_block;
    		if (/*type*/ ctx[0] === "OC") return create_if_block_1;
    		if (/*type*/ ctx[0] === "Beast") return create_if_block_2;
    		if (/*type*/ ctx[0] === "BeastBook") return create_if_block_3;
    		if (/*type*/ ctx[0] === "Preview") return create_if_block_4;
    		if (/*type*/ ctx[0] === "BSR") return create_if_block_5;
    	}

    	let current_block_type = select_block_type(ctx);
    	let if_block = current_block_type && current_block_type(ctx);

    	return {
    		c() {
    			div = element("div");
    			if (if_block) if_block.c();
    			attr(div, "class", div_class_value = "button icon is-" + /*size*/ ctx[1] + " " + /*type*/ ctx[0] + "_bg_btn" + " svelte-1so5nc2");
    			attr(div, "style", /*display*/ ctx[6]);
    			attr(div, "disabled", /*disabled*/ ctx[7]);
    			attr(div, "data-tooltip", /*tooltip*/ ctx[5]);
    			toggle_class(div, "has-tooltip-left", /*size*/ ctx[1] !== "large" && !/*preview*/ ctx[2]);
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			if (if_block) if_block.m(div, null);
    			/*div_binding*/ ctx[12](div);

    			if (!mounted) {
    				dispose = listen(div, "click", /*onclick*/ ctx[8]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (current_block_type === (current_block_type = select_block_type(ctx)) && if_block) {
    				if_block.p(ctx, dirty);
    			} else {
    				if (if_block) if_block.d(1);
    				if_block = current_block_type && current_block_type(ctx);

    				if (if_block) {
    					if_block.c();
    					if_block.m(div, null);
    				}
    			}

    			if (dirty & /*size, type*/ 3 && div_class_value !== (div_class_value = "button icon is-" + /*size*/ ctx[1] + " " + /*type*/ ctx[0] + "_bg_btn" + " svelte-1so5nc2")) {
    				attr(div, "class", div_class_value);
    			}

    			if (dirty & /*display*/ 64) {
    				attr(div, "style", /*display*/ ctx[6]);
    			}

    			if (dirty & /*disabled*/ 128) {
    				attr(div, "disabled", /*disabled*/ ctx[7]);
    			}

    			if (dirty & /*tooltip*/ 32) {
    				attr(div, "data-tooltip", /*tooltip*/ ctx[5]);
    			}

    			if (dirty & /*size, type, size, preview*/ 7) {
    				toggle_class(div, "has-tooltip-left", /*size*/ ctx[1] !== "large" && !/*preview*/ ctx[2]);
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div);

    			if (if_block) {
    				if_block.d();
    			}

    			/*div_binding*/ ctx[12](null);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function new_page(link) {
    	window.open(link, "_blank");
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let disabled;
    	let display;

    	var __awaiter = this && this.__awaiter || function (thisArg, _arguments, P, generator) {
    		function adopt(value) {
    			return value instanceof P
    			? value
    			: new P(function (resolve) {
    						resolve(value);
    					});
    		}

    		return new (P || (P = Promise))(function (resolve, reject) {
    				function fulfilled(value) {
    					try {
    						step(generator.next(value));
    					} catch(e) {
    						reject(e);
    					}
    				}

    				function rejected(value) {
    					try {
    						step(generator["throw"](value));
    					} catch(e) {
    						reject(e);
    					}
    				}

    				function step(result) {
    					result.done
    					? resolve(result.value)
    					: adopt(result.value).then(fulfilled, rejected);
    				}

    				step((generator = generator.apply(thisArg, _arguments || [])).next());
    			});
    	};

    	
    	
    	let { song_hash = undefined } = $$props;
    	let { type } = $$props;
    	let { size } = $$props;
    	let { preview = false } = $$props;
    	let { page = undefined } = $$props;
    	let button;
    	let txtDummyNode;
    	let tooltip;

    	function checked_hash_to_song_info(song_hash) {
    		return __awaiter(this, void 0, void 0, function* () {
    			reset_download_visual();

    			if (song_hash === undefined) {
    				failed_to_download();
    				throw new Error("song_hash is undefined");
    			}

    			const song_info = yield get_data_by_hash(song_hash);

    			if (song_info === undefined) {
    				failed_to_download();
    				throw new Error("song_info is undefined");
    			}

    			return song_info;
    		});
    	}

    	function reset_download_visual() {
    		button.classList.remove("button_success");
    		button.classList.remove("button_error");
    	}

    	function failed_to_download() {
    		button.classList.add("button_error");
    	}

    	function ok_after_download() {
    		button.classList.add("button_success");
    	}

    	function onclick() {
    		return __awaiter(this, void 0, void 0, function* () {
    			if (preview) return;

    			try {
    				const song_info = yield checked_hash_to_song_info(song_hash);

    				if (type === "BS") {
    					new_page(Global.beatsaver_link + song_info.id);
    				} else if (type === "OC") {
    					yield oneclick_install(song_info.id);
    					ok_after_download();
    				} else if (type === "Beast") {
    					new_page(Global.bsaber_songs_link + song_info.id);
    				} else if (type === "BeastBook") {
    					new_page(Global.bsaber_songs_link + song_info.id);
    				} else if (type === "Preview") {
    					new_page("https://skystudioapps.com/bs-viewer/?id=" + song_info.id);
    				} else if (type === "BSR") {
    					$$invalidate(4, txtDummyNode.value = `!bsr ${song_info.id}`, txtDummyNode);
    					txtDummyNode.select();
    					txtDummyNode.setSelectionRange(0, 99999);
    					document.execCommand("copy");
    					ok_after_download();
    				}
    			} catch(err) {
    				console.log("Failed QuickAction", song_hash, err);
    				failed_to_download();
    			}
    		});
    	}

    	function input_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			txtDummyNode = $$value;
    			$$invalidate(4, txtDummyNode);
    		});
    	}

    	function div_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			button = $$value;
    			$$invalidate(3, button);
    		});
    	}

    	$$self.$$set = $$props => {
    		if ('song_hash' in $$props) $$invalidate(9, song_hash = $$props.song_hash);
    		if ('type' in $$props) $$invalidate(0, type = $$props.type);
    		if ('size' in $$props) $$invalidate(1, size = $$props.size);
    		if ('preview' in $$props) $$invalidate(2, preview = $$props.preview);
    		if ('page' in $$props) $$invalidate(10, page = $$props.page);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*preview, song_hash*/ 516) {
    			$$invalidate(7, disabled = !preview && song_hash === undefined
    			? "disabled"
    			: undefined);
    		}

    		if ($$self.$$.dirty & /*preview, page, type*/ 1029) {
    			$$invalidate(6, display = !preview && page !== undefined
    			? `display: var(--sse-show-${page}-${type}, inline-flex);`
    			: "");
    		}

    		if ($$self.$$.dirty & /*type, preview, song_hash*/ 517) {
    			{
    				$$invalidate(5, tooltip = BMButtonHelp[type].tip);

    				if (type === "BeastBook" && !preview) {
    					const bookmarked = song_hash === undefined
    					? false
    					: check_bsaber_bookmark(song_hash);

    					$$invalidate(5, tooltip = bookmarked
    					? "Bookmarked on BeastSaber"
    					: "Not Bookmarked on BeastSaber");
    				}
    			}
    		}
    	};

    	return [
    		type,
    		size,
    		preview,
    		button,
    		txtDummyNode,
    		tooltip,
    		display,
    		disabled,
    		onclick,
    		song_hash,
    		page,
    		input_binding,
    		div_binding
    	];
    }

    class QuickButton extends SvelteComponent {
    	constructor(options) {
    		super();

    		init(
    			this,
    			options,
    			instance$1,
    			create_fragment$1,
    			safe_not_equal,
    			{
    				song_hash: 9,
    				type: 0,
    				size: 1,
    				preview: 2,
    				page: 10
    			},
    			add_css
    		);
    	}
    }

    const PAGE$2 = "songlist";
    function setup_links_songlist() {
        if (!is_songlist_page()) {
            return;
        }
        const song_table = check(document.querySelector("table.ranking.songs"));
        const song_table_header = check(song_table.querySelector("thead tr"));
        for (const btn of BMButton) {
            into(song_table_header, create("th", {
                class: "compact",
                style: bmvar(PAGE$2, btn, "table-cell"),
            }, BMButtonHelp[btn].short));
        }
        const song_rows = song_table.querySelectorAll("tbody tr");
        for (const row of song_rows) {
            const song_hash = get_song_hash_from_row(row);
            for (const btn of BMButton) {
                into(row, create("th", { class: "compact", style: bmvar(PAGE$2, btn, "table-cell") }, as_fragment(target => new QuickButton({
                    target,
                    props: { song_hash, size: "medium", type: btn }
                }))));
            }
        }
    }
    function get_song_hash_from_row(row) {
        const image_link = check(row.querySelector("td.song img")).src;
        return get_song_hash_from_text(image_link);
    }
    function setup_extra_filter_checkboxes() {
        if (!is_songlist_page()) {
            return;
        }
        setup_duplicates_filter_checkbox();
    }
    function setup_duplicates_filter_checkbox() {
        var _a, _b;
        const checked = should_hide_duplicate_songs();
        const duplicates_filter = create("label", { class: "checkbox" }, create("input", {
            id: "duplicates",
            type: "checkbox",
            checked: checked,
            onclick() {
                set_hide_duplicate_songs_filter(!checked);
                window.location.reload();
            }
        }));
        duplicates_filter.appendChild(document.createTextNode(" Hide duplicate songs "));
        const ranked_filter = check((_a = document.querySelector("input#ranked")) === null || _a === void 0 ? void 0 : _a.parentElement);
        (_b = ranked_filter.parentNode) === null || _b === void 0 ? void 0 : _b.insertBefore(duplicates_filter, ranked_filter.nextSibling);
    }
    function apply_extra_filters() {
        if (!is_songlist_page()) {
            return;
        }
        if (should_hide_duplicate_songs()) {
            hide_duplicate_songs();
        }
    }
    function hide_duplicate_songs() {
        const song_table = check(document.querySelector("table.ranking.songs tbody"));
        const song_rows = check(song_table.querySelectorAll("tr"));
        const hashes = new Set();
        for (const row of song_rows) {
            const song_hash = check(get_song_hash_from_row(row));
            if (hashes.has(song_hash)) {
                song_table.removeChild(row);
            }
            else {
                hashes.add(song_hash);
            }
        }
    }
    function should_hide_duplicate_songs() {
        return localStorage.getItem("hide_songlist_duplicates") == "true";
    }
    function set_hide_duplicate_songs_filter(filter) {
        localStorage.setItem("hide_songlist_duplicates", JSON.stringify(filter));
    }
    function is_songlist_page() {
        return location.pathname == "/";
    }

    const api_cache = new SessionCache("beast");
    async function get_data(song_key) {
        const cached_data = api_cache.get(song_key);
        if (cached_data !== undefined)
            return cached_data;
        try {
            const data_str = await fetch2(`https://bsaber.com/wp-json/bsaber-api/songs/${song_key}/ratings`);
            const data = JSON.parse(data_str);
            api_cache.set(song_key, data);
            return data;
        }
        catch (e) {
            return undefined;
        }
    }
    async function get_bookmarks(username, page, count) {
        try {
            const data_str = await fetch2(`https://bsaber.com/wp-json/bsaber-api/songs/?bookmarked_by=${username}&page=${page}&count=${count}`);
            const data = JSON.parse(data_str);
            return data;
        }
        catch (e) {
            return undefined;
        }
    }

    class Lazy {
        constructor(generator) {
            this.generator = generator;
        }
        get() {
            if (this.generator !== undefined) {
                this.value = this.generator();
                this.generator = undefined;
            }
            return this.value;
        }
    }

    const PAGE$1 = "song";
    const shared = new Lazy(() => {
        let details_box = check(document.querySelector(".content .title.is-5"));
        details_box = check(details_box.parentElement);
        const song_hash = get_song_hash_from_text(details_box.innerHTML);
        return { song_hash, details_box };
    });
    function setup_song_filter_tabs() {
        if (!is_song_leaderboard_page()) {
            return;
        }
        const tab_list_content = check(document.querySelector(".tabs > ul"));
        function load_friends() {
            let score_table = check(document.querySelector(".ranking .global > tbody"));
            Global.song_table_backup = score_table;
            const table = check(score_table.parentNode);
            table.removeChild(score_table);
            score_table = table.appendChild(create("tbody"));
            const song_id = Global.leaderboard_reg.exec(window.location.pathname)[1];
            const elements = [];
            for (const [user_id, user] of Object.entries(Global.user_list)) {
                const song = user.songs[song_id];
                if (!song)
                    continue;
                elements.push([song, generate_song_table_row(user_id, user, song)]);
            }
            elements.sort((a, b) => { const [sa, sb] = get_song_compare_value(a[0], b[0]); return sb - sa; });
            elements.forEach(x => score_table.appendChild(x[1]));
            add_percentage$1();
        }
        function load_all() {
            if (!Global.song_table_backup) {
                return;
            }
            let score_table = check(document.querySelector(".ranking .global > tbody"));
            const table = check(score_table.parentNode);
            table.removeChild(score_table);
            score_table = table.appendChild(Global.song_table_backup);
            Global.song_table_backup = undefined;
            add_percentage$1();
        }
        tab_list_content.appendChild(generate_tab("All Scores", "all_scores_tab", load_all, true, true));
        tab_list_content.appendChild(generate_tab("Friends", "friends_tab", load_friends, false, false));
    }
    function setup_dl_link_leaderboard() {
        if (!is_song_leaderboard_page()) {
            return;
        }
        const { song_hash, details_box } = shared.get();
        const tool_strip = create("div", {
            id: "leaderboard_tool_strip",
            style: {
                marginTop: "1em"
            }
        });
        for (const btn of BMButton) {
            new QuickButton({
                target: tool_strip,
                props: { song_hash, size: "large", type: btn, page: PAGE$1 }
            });
        }
        details_box.appendChild(tool_strip);
        const box_style = { class: "box", style: { display: "flex", flexDirection: "column", alignItems: "end", padding: "0.5em 1em" } };
        const beatsaver_box = create("div", box_style, create("b", {}, "BeatSaver"), create("span", { class: "icon" }, create("i", { class: "fas fa-spinner fa-pulse" })));
        const beastsaber_box = create("div", box_style, create("b", {}, "BeastSaber"), create("span", { class: "icon" }, create("i", { class: "fas fa-spinner fa-pulse" })));
        const column_style = { class: "column", style: { padding: "0 0.75em" } };
        details_box.appendChild(create("div", {
            class: "columns",
            style: {
                marginTop: "1em"
            }
        }, create("div", column_style, beatsaver_box), create("div", column_style, beastsaber_box)));
        if (!song_hash)
            return;
        (async () => {
            const data = await get_data_by_hash(song_hash);
            if (!data)
                return;
            show_beatsaver_song_data(beatsaver_box, data);
            const data2 = await get_data(data.id);
            if (!data2)
                return;
            show_beastsaber_song_data(beastsaber_box, data2);
        })();
    }
    function show_beatsaver_song_data(elem, data) {
        intor(elem, create("div", { title: "Downloads" }, `${data.stats.downloads} 💾`), create("div", { title: "Upvotes" }, `${data.stats.upvotes} 👍`), create("div", { title: "Downvotes" }, `${data.stats.downvotes} 👎`), create("div", { title: "Beatmap Rating" }, `${(data.stats.score * 100).toFixed(2)}% 💯`), create("div", { title: "Beatmap Duration" }, `${number_to_timespan(data.metadata.duration)} ⏱`));
    }
    function show_beastsaber_song_data(elem, data) {
        intor(elem, create("div", { title: "Fun Factor" }, `${data.average_ratings.fun_factor} 😃`), create("div", { title: "Rhythm" }, `${data.average_ratings.rhythm} 🎶`), create("div", { title: "Flow" }, `${data.average_ratings.flow} 🌊`), create("div", { title: "Pattern Quality" }, `${data.average_ratings.pattern_quality} 💠`), create("div", { title: "Readability" }, `${data.average_ratings.readability} 👓`), create("div", { title: "Level Quality" }, `${data.average_ratings.level_quality} ✔️`));
    }
    function generate_song_table_row(user_id, user, song) {
        return create("tr", {}, create("td", { class: "picture" }), create("td", { class: "rank" }, "-"), create("td", { class: "player" }, generate_song_table_player(user_id, user)), create("td", { class: "score" }, song.score !== undefined ? format_en(song.score, 0) : "-"), create("td", { class: "timeset" }, moment(song.time).fromNow()), create("td", { class: "mods" }, song.mods !== undefined ? song.mods.toString() : "-"), create("td", { class: "percentage" }, song.accuracy ? (song.accuracy.toString() + "%") : "-"), create("td", { class: "pp" }, create("span", { class: "scoreTop ppValue" }, format_en(song.pp)), create("span", { class: "scoreTop ppLabel" }, "pp")));
    }
    function generate_song_table_player(user_id, user) {
        return create("a", { href: `${Global.scoresaber_link}/u/${user_id}` }, user.name);
    }
    function generate_tab(title, css_id, action, is_active, has_offset) {
        const tabClass = `filter_tab ${toggled_class(is_active, "is-active")} ${toggled_class(has_offset, "offset_tab")}`;
        return create("li", {
            id: css_id,
            class: tabClass,
        }, create("a", {
            class: "has-text-info",
            onclick: () => {
                document.querySelectorAll(".tabs > ul .filter_tab").forEach(x => x.classList.remove("is-active"));
                check(document.getElementById(css_id)).classList.add("is-active");
                if (action)
                    action();
            }
        }, title));
    }
    function highlight_user() {
        const home_user = get_home_user();
        if (!home_user) {
            return;
        }
        const element = document.querySelector(`table.ranking.global a[href='/u/${home_user.id}']`);
        if (element != null) {
            element.parentElement.parentElement.style.backgroundColor = "var(--color-highlight)";
        }
    }
    function add_percentage$1() {
        if (!is_song_leaderboard_page()) {
            return;
        }
        const { song_hash } = shared.get();
        if (!song_hash) {
            return;
        }
        (async () => {
            var _a;
            const data = await get_data_by_hash(song_hash);
            if (!data)
                return;
            const diff_name = (_a = document.querySelector(`div.tabs li.is-active span`)) === null || _a === void 0 ? void 0 : _a.innerText;
            if (!diff_name)
                return;
            const standard_characteristic = data.metadata.characteristics.find(c => c.name === "Standard");
            if (!diff_name || !standard_characteristic)
                return;
            const notes = get_notes_count(diff_name, standard_characteristic);
            if (notes < 0)
                return;
            const max_score = calculate_max_score(notes);
            const user_scores = document.querySelectorAll("table.ranking.global tbody > tr");
            for (const score_row of user_scores) {
                const percentage_column = check(score_row.querySelector("td.percentage"));
                const percentage_value = percentage_column.innerText;
                if (percentage_value === "-") {
                    const score = check(score_row.querySelector("td.score")).innerText;
                    const score_num = number_invariant(score);
                    const calculated_percentage = (100 * score_num / max_score).toFixed(2);
                    percentage_column.innerText = calculated_percentage + "%";
                }
            }
        })();
    }

    const PAGE = "user";
    function setup_dl_link_user_site() {
        if (!is_user_page()) {
            return;
        }
        const table = check(document.querySelector("table.ranking.songs"));
        const table_tr = check(table.querySelector("thead tr"));
        for (const btn of BMButton) {
            into(table_tr, create("th", {
                class: "compact",
                style: bmvar(PAGE, btn, "table-cell"),
            }, BMButtonHelp[btn].short));
        }
        const table_row = table.querySelectorAll("tbody tr");
        for (const row of table_row) {
            const image_link = check(row.querySelector("th.song img")).src;
            const song_hash = get_song_hash_from_text(image_link);
            for (const btn of BMButton) {
                into(row, create("th", { class: "compact", style: bmvar(PAGE, btn, "table-cell") }, as_fragment(target => new QuickButton({
                    target,
                    props: { song_hash, size: "medium", type: btn }
                }))));
            }
        }
    }
    function update_wide_table_css() {
        if (!is_user_page()) {
            return;
        }
        const table = check(document.querySelector("table.ranking.songs"));
        table.classList.toggle("wide_song_table", get_wide_table());
    }
    function setup_user_rank_link_swap() {
        if (!is_user_page()) {
            return;
        }
        const elem_ranking_links = document.querySelectorAll(".content div.columns ul > li > a");
        console.assert(elem_ranking_links.length >= 2, elem_ranking_links);
        const elem_global = elem_ranking_links[0];
        const res_global = check(Global.leaderboard_rank_reg.exec(elem_global.innerText));
        const rank_global = number_invariant(res_global[1]);
        elem_global.href = Global.scoresaber_link + "/global/" + rank_to_page(rank_global, Global.user_per_page_global_leaderboard);
        const elem_country = elem_ranking_links[1];
        const res_country = check(Global.leaderboard_rank_reg.exec(elem_country.innerText));
        const country_str = check(Global.leaderboard_country_reg.exec(elem_country.href));
        const number_country = number_invariant(res_country[1]);
        elem_country.href = Global.scoresaber_link +
            "/global/" + rank_to_page(number_country, Global.user_per_page_global_leaderboard) +
            "?country=" + country_str[2];
    }
    function setup_song_rank_link_swap() {
        if (!is_user_page()) {
            return;
        }
        const song_elems = document.querySelectorAll("table.ranking.songs tbody tr");
        for (const row of song_elems) {
            const rank_elem = check(row.querySelector(".rank"));
            const leaderboard_link = check(row.querySelector("th.song a")).href;
            const rank = number_invariant(rank_elem.innerText.slice(1));
            const rank_str = rank_elem.innerText;
            rank_elem.innerHTML = "";
            into(rank_elem, create("a", {
                href: `${leaderboard_link}?page=${rank_to_page(rank, Global.user_per_page_song_leaderboard)}`
            }, rank_str));
        }
    }
    function rank_to_page(rank, ranks_per_page) {
        return Math.max(Math.floor((rank + ranks_per_page - 1) / ranks_per_page), 1);
    }
    function add_percentage() {
        if (!is_user_page()) {
            return;
        }
        const table = check(document.querySelector("table.ranking.songs"));
        const table_row = table.querySelectorAll("tbody tr");
        for (const row of table_row) {
            const image_link = check(row.querySelector("th.song img")).src;
            const song_hash = get_song_hash_from_text(image_link);
            if (!song_hash) {
                return;
            }
            const score_column = check(row.querySelector(`th.score`));
            if (!score_column.innerText || score_column.innerText.includes("%")) {
                continue;
            }
            (async () => {
                const data = await get_data_by_hash(song_hash);
                if (!data)
                    return;
                const song_column = check(row.querySelector(`th.song`));
                const diff_name = check(song_column.querySelector(`span > span`)).innerText;
                const standard_characteristic = data.metadata.characteristics.find(c => c.name === "Standard");
                if (!diff_name || !standard_characteristic)
                    return;
                const notes = get_notes_count(diff_name, standard_characteristic);
                if (notes < 0)
                    return;
                const max_score = calculate_max_score(notes);
                const user_score = check(score_column.querySelector(".scoreBottom")).innerText;
                const { score } = parse_score_bottom(user_score);
                if (score !== undefined) {
                    const calculated_percentage = (100 * score / max_score).toFixed(2);
                    check(score_column.querySelector(".ppWeightedValue")).innerHTML = `(${calculated_percentage}%)`;
                }
            })();
        }
    }

    function get_state(elem) {
        return !elem.classList.contains(elem.view_class);
    }
    function set_state(elem, state) {
        if (state) {
            elem.classList.remove(elem.view_class);
        }
        else {
            elem.classList.add(elem.view_class);
        }
    }
    function button(opt) {
        var _a, _b;
        const btn = create("div", {
            class: "button"
        }, opt.text);
        btn.view_class = `is-${(_a = opt.type) !== null && _a !== void 0 ? _a : "primary"}`;
        btn.on = () => {
            var _a;
            set_state(btn, true);
            (_a = opt.onclick) === null || _a === void 0 ? void 0 : _a.call(btn, true);
        };
        btn.off = () => {
            var _a;
            set_state(btn, false);
            (_a = opt.onclick) === null || _a === void 0 ? void 0 : _a.call(btn, false);
        };
        btn.toggle = () => {
            var _a;
            const state = !get_state(btn);
            set_state(btn, state);
            (_a = opt.onclick) === null || _a === void 0 ? void 0 : _a.call(btn, state);
        };
        btn.onclick = () => {
            if (btn.getAttribute("disabled") == null) {
                btn.toggle();
            }
        };
        set_state(btn, (_b = opt.default) !== null && _b !== void 0 ? _b : false);
        return btn;
    }

    let chart;
    let chart_elem;
    let chart_button;
    function setup_pp_graph() {
        if (!is_user_page()) {
            return;
        }
        chart_elem = create("canvas");
        const chart_container = create("div", {
            style: {
                width: "100%",
                height: "20em",
                display: "none",
            }
        }, chart_elem);
        insert_compare_display(chart_container);
        chart_button = button({
            default: false,
            text: "Show pp Graph",
            onclick(active) {
                if (!chart_elem)
                    return;
                this.innerText = (active ? "Hide" : "Show") + " pp Graph";
                set_pp_graph_visibility(chart_container, active);
            }
        });
        insert_compare_feature(chart_button);
        update_pp_graph_buttons();
        SseEvent.UserCacheChanged.register(update_pp_graph_buttons);
        SseEvent.CompareUserChanged.register(update_pp_graph);
    }
    async function chartUserData(canvasContext, datasets, labels) {
        if (chart !== undefined) {
            chart.data = {
                labels,
                datasets
            };
            chart.update();
            return;
        }
        if (!await load_chart_lib())
            return;
        chart = new Chart(canvasContext, {
            type: "line",
            data: {
                labels,
                datasets,
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                elements: {
                    point: {
                        radius: 2,
                    }
                },
                tooltips: {
                    callbacks: {
                        label: tooltipItem => String(tooltipItem.yLabel),
                        title: () => "",
                    }
                },
                scales: {
                    xAxes: [{
                            display: false,
                        }]
                }
            },
        });
    }
    function get_graph_data(user_id) {
        const user = Global.user_list[user_id];
        if (user === undefined)
            return [];
        const data = [];
        const data_scaled = [];
        Object.values(user.songs)
            .filter((song) => song.pp > 0)
            .sort((a, b) => b.pp - a.pp)
            .forEach((song, index) => {
            const pp = song.pp;
            data.push(pp);
            data_scaled.push(+(pp * Math.pow(Global.pp_weighting_factor, index)).toFixed(2));
        });
        const color = (Number(user_id) % 3600) / 10;
        return [{
                label: `${user.name} (song pp)`,
                backgroundColor: `hsl(${color}, 100%, 50%)`,
                borderColor: `hsl(${color}, 100%, 50%)`,
                fill: false,
                data,
            }, {
                label: `${user.name} (weighted pp)`,
                backgroundColor: `hsl(${color}, 60%, 25%)`,
                borderColor: `hsl(${color}, 60%, 25%)`,
                fill: false,
                data: data_scaled,
            }];
    }
    function update_pp_graph() {
        if (chart_elem === undefined)
            return;
        let dataSets = get_graph_data(get_current_user().id);
        const compare_user = get_compare_user();
        if (get_current_user().id !== compare_user && compare_user !== undefined)
            dataSets = [...dataSets, ...get_graph_data(compare_user)];
        let max = 0;
        for (const set of dataSets) {
            max = Math.max(max, set.data.length);
        }
        for (const set of dataSets) {
            if (set.data.length < max) {
                set.data.length = max;
                set.data.fill(0, set.data.length, max);
            }
        }
        const labels = Array(max);
        labels.fill("Song", 0, max);
        chartUserData(check(chart_elem.getContext("2d")), dataSets, labels);
    }
    function update_pp_graph_buttons() {
        if (!chart_button) {
            return;
        }
        const user = get_current_user();
        if (Global.user_list[user.id] === undefined) {
            chart_button.setAttribute("disabled", "");
            chart_button.setAttribute("data-tooltip", "Add the user to your score cache for this feature");
            chart_button.off();
        }
        else {
            chart_button.removeAttribute("disabled");
            chart_button.removeAttribute("data-tooltip");
        }
    }
    function set_pp_graph_visibility(elem, active) {
        if (active) {
            if (!chart) {
                update_pp_graph();
            }
            elem.style.display = "";
        }
        else {
            elem.style.display = "none";
        }
    }

    const themes = ["Default", "Cerulean", "Cosmo", "Cyborg", "Darkly", "Flatly",
        "Journal", "Litera", "Lumen", "Lux", "Materia", "Minty", "Nuclear", "Pulse",
        "Sandstone", "Simplex", "Slate", "Solar", "Spacelab", "Superhero", "United",
        "Yeti"];
    const dark_themes = ["Cyborg", "Darkly", "Nuclear", "Slate", "Solar", "Superhero"];
    const theme_light = `:root {
	--color-ahead: rgb(128, 255, 128);
	--color-behind: rgb(255, 128, 128);
	--color-highlight: lightgreen;
}`;
    const theme_dark = `:root {
	--color-ahead: rgb(0, 128, 0);
	--color-behind: rgb(128, 0, 0);
	--color-highlight: darkgreen;
}
.BS_bg_btn {
	background-color: white;
}
/* Reset colors for generic themes */
span.songBottom.time, span.scoreBottom, span.scoreTop.ppWeightedValue {
	color:unset;
}
span.songTop.pp, span.scoreTop.ppValue, span.scoreTop.ppLabel, span.songTop.mapper {
	text-shadow: 1px 1px 2px #000;
}`;
    function setup$1() {
        const style_data = `.compact {
	padding-right: 0 !important;
	padding-left: 0 !important;
	margin-left: 0px !important;
	margin-right: 0px !important;
	text-align: center !important;
}

h5 > * {
	margin-right: 0.3em;
}

.wide_song_table {
	max-width: unset !important;
}

#leaderboard_tool_strip > * {
	margin-right: 0.5em;
}

.offset_tab {
	margin-left: auto;
}

.beatsaver_bg {
	background: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200' viewBox='0 0 200 200' version='1.1'%3E%3Cg fill='none' stroke='%23000000' stroke-width='10'%3E %3Cpath d='M 100,7 189,47 100,87 12,47 Z' stroke-linejoin='round'/%3E %3Cpath d='M 189,47 189,155 100,196 12,155 12,47' stroke-linejoin='round'/%3E %3Cpath d='M 100,87 100,196' stroke-linejoin='round'/%3E %3Cpath d='M 26,77 85,106 53,130 Z' stroke-linejoin='round'/%3E %3C/g%3E %3C/svg%3E") no-repeat center/85%;
	width: 100%;
	height: 100%;
}

.fas_big {
	line-height: 150%;
	padding-right: 0.5em;
	padding-left: 0.5em;
	min-width: 2.25em;
	/* Fix for some themes overriding font */
	font-weight: 900;
	font-family: "Font Awesome 5 Free";
}

.fas_big::before {
	font-size: 120%;
}

[data-tooltip]::before {
	visibility: hidden;
	background-color: #555;
	color: #fff;
	border-radius: 6px;
	position: absolute;
	z-index: 1;
	margin-top: -5px;
	opacity: 0;
	transition: opacity 0.3s;
	padding: 0.2em 1em;
	content: attr(data-tooltip);
	/* Default */
	top: 0;
	left: 50%;
	right: auto;
	bottom: auto;
	transform: translate(-50%, -100%);
}
[data-tooltip].has-tooltip-left::before {
	top: auto;
	right: auto;
	bottom: 50%;
	left: -11px;
	transform: translate(-100%, 50%);
}
[data-tooltip]:hover::before {
	visibility: visible;
	opacity: 1;
}

@keyframes fill_anim {
	0%{background-position:top;}
	20%{background-position:bottom;}
	80%{background-position:bottom;}
	100%{background-position:top;}
}
.button_error {
	background: linear-gradient(to top, red 50%, transparent 50%);
	background-size: 100% 200%;
	background-position:top;
	animation: fill_anim 3s cubic-bezier(.23,1,.32,1) forwards;
}
.button_success {
	background: linear-gradient(to top, green 50%, transparent 50%);
	background-size: 100% 200%;
	background-position:top;
	animation: fill_anim 3s cubic-bezier(.23,1,.32,1) forwards;
}

/* Fix weird tab list offset */

.content li {
	margin-top: 0;
}

/* Fix bulma+scoresable dark color */
/* Theme CSS will be appended and can therefore
 * conveniently overwrite those rules.
 * This makes them effectively useful for the default
 * Light/Dark Themes of ScoreSaber */

.navbar-dropdown, .modal-card-head, .modal-card-foot {
	color: var(--textColor, black);
	background-color: var(--background, white);
	border-color: var(--foreground, #dbdbdb);
}

.box, .modal-card-body {
	color: var(--textColor, black);
	background-color: var(--background, white);
}
`;
        SSE_addStyle(style_data);
        into(document.head, create("link", { rel: "stylesheet", href: "https://cdn.jsdelivr.net/npm/bulma-checkradio/dist/css/bulma-checkradio.min.css" }));
    }

    /* src\components\SettingsDialogue.svelte generated by Svelte v3.41.0 */

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[16] = list[i];
    	return child_ctx;
    }

    function get_each_context_1(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[19] = list[i];
    	return child_ctx;
    }

    function get_each_context_2(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[19] = list[i];
    	return child_ctx;
    }

    function get_each_context_3(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[24] = list[i];
    	return child_ctx;
    }

    // (122:5) {#each themes as name}
    function create_each_block_3(ctx) {
    	let option;
    	let t0_value = /*name*/ ctx[24] + "";
    	let t0;
    	let t1_value = (dark_themes.includes(/*name*/ ctx[24]) ? " (Dark)" : "") + "";
    	let t1;
    	let t2;
    	let option_value_value;
    	let option_selected_value;

    	return {
    		c() {
    			option = element("option");
    			t0 = text(t0_value);
    			t1 = text(t1_value);
    			t2 = space();
    			option.__value = option_value_value = /*name*/ ctx[24];
    			option.value = option.__value;
    			option.selected = option_selected_value = /*name*/ ctx[24] === /*current_theme*/ ctx[0];
    		},
    		m(target, anchor) {
    			insert(target, option, anchor);
    			append(option, t0);
    			append(option, t1);
    			append(option, t2);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*current_theme, themes*/ 1 && option_selected_value !== (option_selected_value = /*name*/ ctx[24] === /*current_theme*/ ctx[0])) {
    				option.selected = option_selected_value;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(option);
    		}
    	};
    }

    // (154:3) {#each env.BMButton as button}
    function create_each_block_2(ctx) {
    	let th;
    	let quickbutton;
    	let t;
    	let current;

    	quickbutton = new QuickButton({
    			props: {
    				size: "medium",
    				song_hash: undefined,
    				type: /*button*/ ctx[19],
    				preview: true
    			}
    		});

    	return {
    		c() {
    			th = element("th");
    			create_component(quickbutton.$$.fragment);
    			t = space();
    		},
    		m(target, anchor) {
    			insert(target, th, anchor);
    			mount_component(quickbutton, th, null);
    			append(th, t);
    			current = true;
    		},
    		p: noop,
    		i(local) {
    			if (current) return;
    			transition_in(quickbutton.$$.fragment, local);
    			current = true;
    		},
    		o(local) {
    			transition_out(quickbutton.$$.fragment, local);
    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(th);
    			destroy_component(quickbutton);
    		}
    	};
    }

    // (168:4) {#each env.BMButton as button}
    function create_each_block_1(ctx) {
    	let td;
    	let input;
    	let input_checked_value;
    	let t;
    	let label;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			td = element("td");
    			input = element("input");
    			t = space();
    			label = element("label");
    			attr(input, "id", "show-" + /*page*/ ctx[16] + "-" + /*button*/ ctx[19]);
    			attr(input, "type", "checkbox");
    			attr(input, "class", "is-checkradio");
    			attr(input, "data-key", "" + (/*page*/ ctx[16] + "-" + /*button*/ ctx[19]));
    			input.checked = input_checked_value = /*bm*/ ctx[2][`${/*page*/ ctx[16]}-${/*button*/ ctx[19]}`];
    			attr(label, "for", "show-" + /*page*/ ctx[16] + "-" + /*button*/ ctx[19]);
    		},
    		m(target, anchor) {
    			insert(target, td, anchor);
    			append(td, input);
    			append(td, t);
    			append(td, label);

    			if (!mounted) {
    				dispose = listen(input, "change", /*updateButtonMatrix*/ ctx[10]);
    				mounted = true;
    			}
    		},
    		p(ctx, dirty) {
    			if (dirty & /*bm*/ 4 && input_checked_value !== (input_checked_value = /*bm*/ ctx[2][`${/*page*/ ctx[16]}-${/*button*/ ctx[19]}`])) {
    				input.checked = input_checked_value;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(td);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    // (165:2) {#each env.BMPage as page}
    function create_each_block(ctx) {
    	let tr;
    	let td;
    	let t0_value = /*page*/ ctx[16] + "";
    	let t0;
    	let t1;
    	let t2;
    	let each_value_1 = BMButton;
    	let each_blocks = [];

    	for (let i = 0; i < each_value_1.length; i += 1) {
    		each_blocks[i] = create_each_block_1(get_each_context_1(ctx, each_value_1, i));
    	}

    	return {
    		c() {
    			tr = element("tr");
    			td = element("td");
    			t0 = text(t0_value);
    			t1 = space();

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t2 = space();
    		},
    		m(target, anchor) {
    			insert(target, tr, anchor);
    			append(tr, td);
    			append(td, t0);
    			append(tr, t1);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(tr, null);
    			}

    			append(tr, t2);
    		},
    		p(ctx, dirty) {
    			if (dirty & /*env, bm, updateButtonMatrix*/ 1028) {
    				each_value_1 = BMButton;
    				let i;

    				for (i = 0; i < each_value_1.length; i += 1) {
    					const child_ctx = get_each_context_1(ctx, each_value_1, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block_1(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(tr, t2);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value_1.length;
    			}
    		},
    		d(detaching) {
    			if (detaching) detach(tr);
    			destroy_each(each_blocks, detaching);
    		}
    	};
    }

    function create_fragment(ctx) {
    	let div14;
    	let div2;
    	let label0;
    	let t1;
    	let div1;
    	let div0;
    	let select;
    	let t2;
    	let div3;
    	let t4;
    	let div4;
    	let input0;
    	let t5;
    	let label2;
    	let t7;
    	let div5;
    	let t9;
    	let table;
    	let tr;
    	let th;
    	let t10;
    	let t11;
    	let t12;
    	let div6;
    	let t14;
    	let div7;
    	let input1;
    	let t15;
    	let label5;
    	let t17;
    	let div8;
    	let t19;
    	let div9;
    	let button0;
    	let t21;
    	let button1;
    	let t23;
    	let div10;
    	let t25;
    	let div13;
    	let div11;
    	let input2;
    	let t26;
    	let span;
    	let t27;
    	let div12;
    	let button2;
    	let i1;
    	let t28;
    	let br;
    	let current;
    	let mounted;
    	let dispose;
    	let each_value_3 = themes;
    	let each_blocks_2 = [];

    	for (let i = 0; i < each_value_3.length; i += 1) {
    		each_blocks_2[i] = create_each_block_3(get_each_context_3(ctx, each_value_3, i));
    	}

    	let each_value_2 = BMButton;
    	let each_blocks_1 = [];

    	for (let i = 0; i < each_value_2.length; i += 1) {
    		each_blocks_1[i] = create_each_block_2(get_each_context_2(ctx, each_value_2, i));
    	}

    	const out = i => transition_out(each_blocks_1[i], 1, 1, () => {
    		each_blocks_1[i] = null;
    	});

    	let each_value = BMPage;
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	return {
    		c() {
    			div14 = element("div");
    			div2 = element("div");
    			label0 = element("label");
    			label0.textContent = "Theme";
    			t1 = space();
    			div1 = element("div");
    			div0 = element("div");
    			select = element("select");

    			for (let i = 0; i < each_blocks_2.length; i += 1) {
    				each_blocks_2[i].c();
    			}

    			t2 = space();
    			div3 = element("div");
    			div3.innerHTML = `<label class="label">Song Table Options</label>`;
    			t4 = space();
    			div4 = element("div");
    			input0 = element("input");
    			t5 = space();
    			label2 = element("label");
    			label2.textContent = "Expand table to full width";
    			t7 = space();
    			div5 = element("div");
    			div5.innerHTML = `<label class="label">QuickAction Buttons</label>`;
    			t9 = space();
    			table = element("table");
    			tr = element("tr");
    			th = element("th");
    			t10 = space();

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].c();
    			}

    			t11 = space();

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			t12 = space();
    			div6 = element("div");
    			div6.innerHTML = `<label class="label">Other</label>`;
    			t14 = space();
    			div7 = element("div");
    			input1 = element("input");
    			t15 = space();
    			label5 = element("label");
    			label5.textContent = "Use new ScoreSaber api";
    			t17 = space();
    			div8 = element("div");
    			div8.innerHTML = `<label class="label">Tools</label>`;
    			t19 = space();
    			div9 = element("div");
    			button0 = element("button");
    			button0.textContent = "Update All User";
    			t21 = space();
    			button1 = element("button");
    			button1.textContent = "Force Update All User";
    			t23 = space();
    			div10 = element("div");
    			div10.innerHTML = `<label class="label">Beastsaber Bookmarks</label>`;
    			t25 = space();
    			div13 = element("div");
    			div11 = element("div");
    			input2 = element("input");
    			t26 = space();
    			span = element("span");
    			span.innerHTML = `<i class="fas fa-user fa-xs"></i>`;
    			t27 = space();
    			div12 = element("div");
    			button2 = element("button");
    			i1 = element("i");
    			t28 = space();
    			br = element("br");
    			attr(label0, "class", "label");
    			if (/*current_theme*/ ctx[0] === void 0) add_render_callback(() => /*select_change_handler*/ ctx[11].call(select));
    			attr(div0, "class", "select");
    			attr(div1, "class", "control");
    			attr(div2, "class", "field");
    			attr(div3, "class", "field");
    			attr(input0, "id", "wide_song_table");
    			attr(input0, "type", "checkbox");
    			attr(input0, "class", "is-checkradio");
    			input0.checked = get_wide_table();
    			attr(label2, "for", "wide_song_table");
    			attr(label2, "class", "checkbox");
    			attr(div4, "class", "field");
    			attr(div5, "class", "field");
    			attr(table, "class", "table");
    			attr(div6, "class", "field");
    			attr(input1, "id", "use_new_ss_api");
    			attr(input1, "type", "checkbox");
    			attr(input1, "class", "is-checkradio");
    			input1.checked = get_use_new_ss_api();
    			attr(label5, "for", "use_new_ss_api");
    			attr(label5, "class", "checkbox");
    			attr(div7, "class", "field");
    			attr(div8, "class", "field");
    			attr(button0, "class", "button");
    			attr(button1, "class", "button is-danger");
    			attr(div9, "class", "buttons");
    			attr(div10, "class", "field");
    			attr(input2, "id", "bsaber_username");
    			attr(input2, "type", "text");
    			attr(input2, "class", "input");
    			attr(input2, "placeholder", "Username");
    			input2.value = get_bsaber_username() ?? "";
    			attr(span, "class", "icon is-small is-left");
    			attr(div11, "class", "control has-icons-left");
    			attr(i1, "class", "fas fa-sync");
    			toggle_class(i1, "fa-spin", /*isBeastSaberSyncing*/ ctx[1]);
    			attr(button2, "class", "button bsaber_update_bookmarks");
    			attr(button2, "data-tooltip", "Load Bookmarks");
    			attr(div12, "class", "control");
    			attr(div13, "class", "field has-addons");
    		},
    		m(target, anchor) {
    			insert(target, div14, anchor);
    			append(div14, div2);
    			append(div2, label0);
    			append(div2, t1);
    			append(div2, div1);
    			append(div1, div0);
    			append(div0, select);

    			for (let i = 0; i < each_blocks_2.length; i += 1) {
    				each_blocks_2[i].m(select, null);
    			}

    			select_option(select, /*current_theme*/ ctx[0]);
    			append(div14, t2);
    			append(div14, div3);
    			append(div14, t4);
    			append(div14, div4);
    			append(div4, input0);
    			append(div4, t5);
    			append(div4, label2);
    			append(div14, t7);
    			append(div14, div5);
    			append(div14, t9);
    			append(div14, table);
    			append(table, tr);
    			append(tr, th);
    			append(tr, t10);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				each_blocks_1[i].m(tr, null);
    			}

    			append(table, t11);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(table, null);
    			}

    			append(div14, t12);
    			append(div14, div6);
    			append(div14, t14);
    			append(div14, div7);
    			append(div7, input1);
    			append(div7, t15);
    			append(div7, label5);
    			append(div14, t17);
    			append(div14, div8);
    			append(div14, t19);
    			append(div14, div9);
    			append(div9, button0);
    			append(div9, t21);
    			append(div9, button1);
    			append(div14, t23);
    			append(div14, div10);
    			append(div14, t25);
    			append(div14, div13);
    			append(div13, div11);
    			append(div11, input2);
    			append(div11, t26);
    			append(div11, span);
    			append(div13, t27);
    			append(div13, div12);
    			append(div12, button2);
    			append(button2, i1);
    			append(div14, t28);
    			append(div14, br);
    			current = true;

    			if (!mounted) {
    				dispose = [
    					listen(select, "change", /*select_change_handler*/ ctx[11]),
    					listen(select, "change", /*onChangeTheme*/ ctx[3]),
    					listen(input0, "change", /*onChangeWideTable*/ ctx[4]),
    					listen(input1, "change", /*onChangeUseNewSSApi*/ ctx[5]),
    					listen(button0, "click", /*updateAllUser*/ ctx[6]),
    					listen(button1, "click", /*forceUpdateAllUser*/ ctx[7]),
    					listen(input2, "change", /*onChangeBeastSaber*/ ctx[8]),
    					listen(button2, "click", /*beastSaberSync*/ ctx[9])
    				];

    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*themes, current_theme, dark_themes*/ 1) {
    				each_value_3 = themes;
    				let i;

    				for (i = 0; i < each_value_3.length; i += 1) {
    					const child_ctx = get_each_context_3(ctx, each_value_3, i);

    					if (each_blocks_2[i]) {
    						each_blocks_2[i].p(child_ctx, dirty);
    					} else {
    						each_blocks_2[i] = create_each_block_3(child_ctx);
    						each_blocks_2[i].c();
    						each_blocks_2[i].m(select, null);
    					}
    				}

    				for (; i < each_blocks_2.length; i += 1) {
    					each_blocks_2[i].d(1);
    				}

    				each_blocks_2.length = each_value_3.length;
    			}

    			if (dirty & /*current_theme, themes*/ 1) {
    				select_option(select, /*current_theme*/ ctx[0]);
    			}

    			if (dirty & /*undefined, env*/ 0) {
    				each_value_2 = BMButton;
    				let i;

    				for (i = 0; i < each_value_2.length; i += 1) {
    					const child_ctx = get_each_context_2(ctx, each_value_2, i);

    					if (each_blocks_1[i]) {
    						each_blocks_1[i].p(child_ctx, dirty);
    						transition_in(each_blocks_1[i], 1);
    					} else {
    						each_blocks_1[i] = create_each_block_2(child_ctx);
    						each_blocks_1[i].c();
    						transition_in(each_blocks_1[i], 1);
    						each_blocks_1[i].m(tr, null);
    					}
    				}

    				group_outros();

    				for (i = each_value_2.length; i < each_blocks_1.length; i += 1) {
    					out(i);
    				}

    				check_outros();
    			}

    			if (dirty & /*env, bm, updateButtonMatrix*/ 1028) {
    				each_value = BMPage;
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						each_blocks[i].m(table, null);
    					}
    				}

    				for (; i < each_blocks.length; i += 1) {
    					each_blocks[i].d(1);
    				}

    				each_blocks.length = each_value.length;
    			}

    			if (dirty & /*isBeastSaberSyncing*/ 2) {
    				toggle_class(i1, "fa-spin", /*isBeastSaberSyncing*/ ctx[1]);
    			}
    		},
    		i(local) {
    			if (current) return;

    			for (let i = 0; i < each_value_2.length; i += 1) {
    				transition_in(each_blocks_1[i]);
    			}

    			current = true;
    		},
    		o(local) {
    			each_blocks_1 = each_blocks_1.filter(Boolean);

    			for (let i = 0; i < each_blocks_1.length; i += 1) {
    				transition_out(each_blocks_1[i]);
    			}

    			current = false;
    		},
    		d(detaching) {
    			if (detaching) detach(div14);
    			destroy_each(each_blocks_2, detaching);
    			destroy_each(each_blocks_1, detaching);
    			destroy_each(each_blocks, detaching);
    			mounted = false;
    			run_all(dispose);
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	var __awaiter = this && this.__awaiter || function (thisArg, _arguments, P, generator) {
    		function adopt(value) {
    			return value instanceof P
    			? value
    			: new P(function (resolve) {
    						resolve(value);
    					});
    		}

    		return new (P || (P = Promise))(function (resolve, reject) {
    				function fulfilled(value) {
    					try {
    						step(generator.next(value));
    					} catch(e) {
    						reject(e);
    					}
    				}

    				function rejected(value) {
    					try {
    						step(generator["throw"](value));
    					} catch(e) {
    						reject(e);
    					}
    				}

    				function step(result) {
    					result.done
    					? resolve(result.value)
    					: adopt(result.value).then(fulfilled, rejected);
    				}

    				step((generator = generator.apply(thisArg, _arguments || [])).next());
    			});
    	};

    	var _a;
    	

    	let current_theme = (_a = localStorage.getItem("theme_name")) !== null && _a !== void 0
    	? _a
    	: "Default";

    	function onChangeTheme() {
    		settings_set_theme(this.value);
    	}

    	function onChangeWideTable() {
    		set_wide_table(this.checked);
    		update_wide_table_css();
    	}

    	function onChangeUseNewSSApi() {
    		set_use_new_ss_api(this.checked);
    	}

    	function updateAllUser() {
    		return __awaiter(this, void 0, void 0, function* () {
    			yield fetch_all();
    		});
    	}

    	function forceUpdateAllUser() {
    		return __awaiter(this, void 0, void 0, function* () {
    			const resp = yield show_modal({
    				text: "Warning: This might take a long time, depending " + "on how many users you have in your library list and " + "how many songs they have on ScoreSaber.\n" + "Use this only when all pp is fucked again.\n" + "And have mercy on the ScoreSaber servers.",
    				buttons: {
    					ok: { text: "Continue", class: "is-success" },
    					x: { text: "Cancel", class: "is-danger" }
    				}
    			});

    			if (resp === "ok") {
    				yield fetch_all(true);
    			}
    		});
    	}

    	function onChangeBeastSaber() {
    		set_bsaber_username(this.value);
    		update_button_visibility();
    	}

    	let isBeastSaberSyncing = false;

    	function beastSaberSync() {
    		return __awaiter(this, void 0, void 0, function* () {
    			const bsaber_username = get_bsaber_username();

    			if (!bsaber_username) {
    				yield show_modal({
    					text: "Please enter a username first.",
    					buttons: buttons.OkOnly
    				});

    				return;
    			}

    			$$invalidate(1, isBeastSaberSyncing = true);
    			yield update_bsaber_bookmark_cache(bsaber_username);
    			$$invalidate(1, isBeastSaberSyncing = false);
    		});
    	}

    	function update_bsaber_bookmark_cache(username) {
    		return __awaiter(this, void 0, void 0, function* () {
    			for (let page = 1; ; page++) {
    				SseEvent.StatusInfo.invoke({ text: `Loading BeastSaber page ${page}` });
    				const bookmarks = yield get_bookmarks(username, page, 50);
    				if (!bookmarks) break;
    				process_bookmarks(bookmarks.songs);

    				if (bookmarks.next_page === null) {
    					break;
    				}
    			}

    			SseEvent.StatusInfo.invoke({
    				text: "Finished loading BeastSaber bookmarks"
    			});
    		});
    	}

    	function process_bookmarks(songs) {
    		for (const song of songs) {
    			if (!song.hash) {
    				continue;
    			}

    			if (!check_bsaber_bookmark(song.hash)) {
    				add_bsaber_bookmark(song.hash);
    			}
    		}
    	}

    	const bm = get_button_matrix();

    	function updateButtonMatrix() {
    		let key = this.dataset.key;
    		let val = this.checked;
    		logc("Updating", key, val);
    		$$invalidate(2, bm[key] = val, bm);
    		set_button_matrix(bm);
    		update_button_visibility();
    	}

    	function select_change_handler() {
    		current_theme = select_value(this);
    		$$invalidate(0, current_theme);
    	}

    	return [
    		current_theme,
    		isBeastSaberSyncing,
    		bm,
    		onChangeTheme,
    		onChangeWideTable,
    		onChangeUseNewSSApi,
    		updateAllUser,
    		forceUpdateAllUser,
    		onChangeBeastSaber,
    		beastSaberSync,
    		updateButtonMatrix,
    		select_change_handler
    	];
    }

    class SettingsDialogue extends SvelteComponent {
    	constructor(options) {
    		super();
    		init(this, options, instance, create_fragment, safe_not_equal, {});
    	}
    }

    let notify_box;
    let settings_modal;
    function setup() {
        notify_box = create("div", { class: "field" });
        const cog = create("i", { class: "fas fa-cog" });
        into(get_navbar(), create("a", {
            id: "settings_menu",
            class: "navbar-item",
            style: {
                cursor: "pointer",
            },
            onclick: () => show_settings_lazy(),
        }, cog));
        SseEvent.UserNotification.register(() => {
            const ntfys = SseEvent.getNotifications();
            if (ntfys.length > 0) {
                cog.classList.remove("fa-cog");
                cog.classList.add("fa-bell");
                cog.style.color = "yellow";
            }
            else {
                cog.classList.remove("fa-bell");
                cog.classList.add("fa-cog");
                cog.style.color = "";
            }
            if (!notify_box)
                return;
            clear_children(notify_box);
            for (const ntfy of ntfys) {
                into(notify_box, create("div", { class: `notification is-${ntfy.type}` }, ntfy.msg));
            }
        });
    }
    function show_settings_lazy() {
        if (settings_modal) {
            settings_modal.show();
            return;
        }
        const status_box = create("div", {});
        SseEvent.StatusInfo.register((status) => intor(status_box, status.text));
        const set_div = create("div");
        new SettingsDialogue({ target: set_div });
        settings_modal = create_modal({
            title: "Options",
            text: set_div,
            footer: status_box,
            type: "card",
            default: true,
        });
    }
    async function settings_set_theme(name) {
        let css = "";
        if (name !== "Default") {
            css = await fetch2(`https://unpkg.com/bulmaswatch/${name.toLowerCase()}/bulmaswatch.min.css`);
        }
        localStorage.setItem("theme_name", name);
        localStorage.setItem("theme_css", css);
        load_theme(name, css);
    }
    function load_last_theme() {
        let theme_name = localStorage.getItem("theme_name");
        let theme_css = localStorage.getItem("theme_css");
        if (!theme_name || !theme_css) {
            theme_name = "Default";
            theme_css = "";
        }
        load_theme(theme_name, theme_css);
    }
    function load_theme(name, css) {
        let css_fin;
        if (get_scoresaber_darkmode() || dark_themes.includes(name)) {
            css_fin = css + " " + theme_dark;
        }
        else {
            css_fin = css + " " + theme_light;
        }
        if (!Global.style_themed_elem) {
            Global.style_themed_elem = SSE_addStyle(css_fin);
        }
        else {
            Global.style_themed_elem.innerHTML = css_fin;
        }
    }
    function get_scoresaber_darkmode() {
        return document.cookie.includes("dark=1");
    }
    function update_button_visibility() {
        const bm = get_button_matrix();
        for (const pb of BMPageButtons) {
            const showButton = bm[pb] || false;
            document.documentElement.style.setProperty(`--sse-show-${pb}`, showButton ? "unset" : "none");
        }
    }

    async function check_for_updates() {
        const current_version = SSE_info.script.version;
        const update_check = localStorage.getItem("update_check");
        if (update_check && Number(update_check) >= new Date().getTime()) {
            return;
        }
        const latest_script = await fetch2(`https://raw.githubusercontent.com/Splamy/ScoreSaberEnhanced/master/scoresaber.user.js`);
        const latest_version = Global.script_version_reg.exec(latest_script)[1];
        if (current_version !== latest_version) {
            SseEvent.addNotification({ msg: "An update is available", type: "warning" });
        }
        else {
            const now = new Date();
            now.setDate(now.getDate() + 1);
            localStorage.setItem("update_check", now.getTime().toString());
        }
    }

    setup$3();
    setup$2();
    load();
    let has_loaded_head = false;
    function on_load_head() {
        if (!document.head) {
            logc("Head not ready");
            return;
        }
        if (has_loaded_head) {
            logc("Already loaded head");
            return;
        }
        has_loaded_head = true;
        logc("Loading head");
        setup$1();
        load_last_theme();
    }
    let has_loaded_body = false;
    function on_load_body() {
        if (document.readyState !== "complete" && document.readyState !== "interactive") {
            logc("Body not ready");
            return;
        }
        if (has_loaded_body) {
            logc("Already loaded body");
            return;
        }
        has_loaded_body = true;
        logc("Loading body");
        setup_dl_link_user_site();
        add_percentage();
        setup_user_rank_link_swap();
        setup_song_rank_link_swap();
        update_wide_table_css();
        setup_dl_link_leaderboard();
        setup_song_filter_tabs();
        highlight_user();
        add_percentage$1();
        setup_links_songlist();
        setup_extra_filter_checkboxes();
        apply_extra_filters();
        setup_self_pin_button();
        setup_self_button();
        setup_user_compare();
        setup();
        update_button_visibility();
        setup_pp_graph();
        check_for_updates();
    }
    function onload() {
        on_load_head();
        on_load_body();
    }
    onload();
    window.addEventListener("DOMContentLoaded", onload);
    window.addEventListener("load", onload);

}());
//# sourceMappingURL=rollup.js.map
