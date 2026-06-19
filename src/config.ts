import type {
	ExpressiveCodeConfig,
	LicenseConfig,
	NavBarConfig,
	ProfileConfig,
	SiteConfig,
} from "./types/config";
import { LinkPreset } from "./types/config";

export const siteConfig: SiteConfig = {
	title: "陈东方的个人博客空间",
	subtitle: "万千芳华入盏中，举杯共赏论红尘。",
	lang: "zh_CN",
	themeColor: {
		hue: 200,
		fixed: true,
	},
	banner: {
		enable: false,
		src: "",
		position: "center",
		credit: {
			enable: false,
			text: "",
			url: "",
		},
	},
	toc: {
		enable: true,
		depth: 2,
	},
	favicon: [],
};

export const navBarConfig: NavBarConfig = {
	links: [
		LinkPreset.Home,
		{
			name: "诗词",
			url: "/poetry/",
			external: false,
		},
		LinkPreset.Archive,
		{
			name: "项目",
			url: "/projects/",
			external: false,
		},
		LinkPreset.About,
		{
			name: "GitHub",
			url: "https://github.com/Chen-DongFang",
			external: true,
		},
	],
};

export const profileConfig: ProfileConfig = {
	avatar: "assets/images/avatar.jpg",
	name: "陈东方",
	bio: "盛夏的蝉鸣难以颤动孤寂的心，唯有热爱的薪火，总在寒夜里点燃那片潮湿的魂。",
	links: [
		{
			name: "GitHub",
			icon: "fa6-brands:github",
			url: "https://github.com/Chen-DongFang",
		},
		{
			name: "QQ空间",
			icon: "fa6-brands:qq",
			url: "https://user.qzone.qq.com/2873044836",
		},
		{
			name: "哔哩哔哩",
			icon: "fa6-brands:bilibili",
			url: "https://space.bilibili.com/110526898",
		},
		{
			name: "Steam",
			icon: "fa6-brands:steam",
			url: "https://store.steampowered.com",
		},
	],
};

export const licenseConfig: LicenseConfig = {
	enable: true,
	name: "CC BY-NC-SA 4.0",
	url: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
};

export const expressiveCodeConfig: ExpressiveCodeConfig = {
	theme: "github-dark",
};
