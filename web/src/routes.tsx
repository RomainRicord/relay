const Routes = {
	home: "/",
	dashboard: "/dashboard",
	login: "/login",
	keys: "/keys",
};

export type RouteKey = keyof typeof Routes;

export default Routes;
