const Routes = {
	home: "/",
	dashboard: "/dashboard",
	login: "/login",
	keys: "/keys",
	docs: "/docs",
};

export type RouteKey = keyof typeof Routes;

export default Routes;
