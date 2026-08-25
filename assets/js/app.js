// El "?v=" al final de cada import local es a propósito: los módulos ES se
// cachean agresivo en el navegador y, sin esto, un cambio en el código puede
// no reflejarse hasta hacer un refresco forzado (Ctrl+Shift+R). Se sube este
// número cada vez que se toca alguno de estos archivos.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=2';
import { renderProductos } from './screens/productos.js?v=13';
import { renderVentas } from './screens/ventas.js?v=6';
import { renderDashboard } from './screens/dashboard.js?v=9';
import { renderConfiguracion } from './screens/configuracion.js?v=4';
import { renderGastos } from './screens/gastos.js?v=4';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const root = document.getElementById('acp-root');

// El administrador siempre tiene todo. Para vendedor, cada módulo opcional
// (dashboard/gastos/productos) depende de lo que el administrador le haya
// habilitado a esa persona puntual en Configuración → Permisos
// (memberships.vendor_permissions — es por vendedor, no por empresa).
function permissionsFor( membership ) {
	const isAdmin = 'administrador' === membership.role;
	const vendorPerms = membership.vendor_permissions || {};

	return {
		isAdmin,
		canSeeDashboard: isAdmin || !! vendorPerms.dashboard,
		canSeeGastos: isAdmin || !! vendorPerms.gastos,
		canSeeProductos: isAdmin || !! vendorPerms.productos,
		canCreateProducts: isAdmin || !! vendorPerms.productos,
		canEditProducts: isAdmin, // nunca vendedor, sin excepción
	};
}

function navItemsFor( perms ) {
	const items = [];
	if ( perms.canSeeDashboard ) {
		items.push( { id: 'dashboard', label: 'Dashboard' } );
	}
	items.push( { id: 'ventas', label: 'Ventas' } );
	if ( perms.canSeeProductos ) {
		items.push( { id: 'productos', label: 'Productos' } );
	}
	if ( perms.canSeeGastos ) {
		items.push( { id: 'gastos', label: 'Gastos' } );
	}
	items.push( { id: 'configuracion', label: 'Configuración' } );
	return items;
}

let state = {
	screen: 'loading', // loading | login | org-select | app
	loginError: '',
	loginBusy: false,
	memberships: [],
	activeMembership: null,
	activeNav: 'ventas',
	navParams: null,
};

function setState( patch ) {
	state = { ...state, ...patch };
	render();
}

// Le permite a una pantalla (ej. una tarjeta clickeable del Dashboard) mandar
// a otra pantalla con un filtro inicial — como "Ventas del mes" abriendo
// Ventas ya puesto en modo mes en vez del "hoy" por defecto.
function navigateTo( navId, params ) {
	setState( { activeNav: navId, navParams: params || null } );
}

async function init() {
	const { data } = await supabase.auth.getSession();
	if ( ! data.session ) {
		setState( { screen: 'login' } );
		return;
	}
	await loadMemberships( data.session.user.id );
}

async function loadMemberships( userId ) {
	// Ojo: la tabla memberships tiene una regla de seguridad que deja ver a
	// CUALQUIER miembro de una empresa el resto del equipo de esa empresa
	// (para el listado de usuarios en Configuración) — sin este filtro por
	// user_id, esta consulta trae también las filas de otros compañeros que
	// comparten empresa, y el selector de empresas termina mostrando
	// entradas de más (el mismo nombre de empresa "duplicado"). El userId
	// se pasa desde afuera (ya lo tenemos de getSession()/signIn()) para no
	// pagar una llamada de red extra a auth.getUser() acá — eso fue lo que
	// hizo más lento el login recién.
	const { data, error } = await supabase
		.from( 'memberships' )
		.select( 'id, user_id, role, full_name, organization_id, vendor_permissions, organizations ( id, name, slug, suggested_margin_percent )' )
		.eq( 'user_id', userId );

	if ( error ) {
		setState( { screen: 'login', loginError: 'No se pudo cargar tu cuenta: ' + error.message } );
		return;
	}

	if ( ! data || 0 === data.length ) {
		setState( {
			screen: 'login',
			loginError: 'Tu usuario no tiene ninguna empresa asociada todavía. Pide que te agreguen como miembro.',
		} );
		return;
	}

	const savedOrgId = sessionStorage.getItem( 'acp_prime_org_id' );
	const saved = data.find( ( m ) => m.organization_id === savedOrgId );

	if ( 1 === data.length ) {
		selectMembership( data[ 0 ], data );
		return;
	}

	if ( saved ) {
		selectMembership( saved, data );
		return;
	}

	setState( { screen: 'org-select', memberships: data } );
}

function selectMembership( membership, allMemberships ) {
	sessionStorage.setItem( 'acp_prime_org_id', membership.organization_id );
	const perms = permissionsFor( membership );
	setState( {
		screen: 'app',
		memberships: allMemberships,
		activeMembership: membership,
		activeNav: perms.canSeeDashboard ? 'dashboard' : 'ventas',
	} );
}

async function handleLogin( email, pin ) {
	setState( { loginBusy: true, loginError: '' } );
	const { data, error } = await supabase.auth.signInWithPassword( { email, password: pin } );
	if ( error ) {
		setState( { loginBusy: false, loginError: 'Correo o PIN incorrecto.' } );
		return;
	}
	// loginBusy se apaga DESPUÉS de loadMemberships (no antes) — si no, hay
	// un instante donde ya no está "cargando" pero todavía seguimos en la
	// pantalla de login (loadMemberships aún no cambió de pantalla), y se ve
	// como un parpadeo del login completo antes de saltar a la siguiente.
	await loadMemberships( data.user.id );
	setState( { loginBusy: false } );
}

async function handleLogout() {
	sessionStorage.removeItem( 'acp_prime_org_id' );
	await supabase.auth.signOut();
	setState( {
		screen: 'login',
		loginError: '',
		memberships: [],
		activeMembership: null,
	} );
}

function render() {
	if ( 'loading' === state.screen ) {
		root.innerHTML = `
			<div class="acp-center-screen">
				<div class="acp-loading">
					<img src="assets/img/loading.svg" alt="Cargando" width="96" height="96" />
				</div>
			</div>
		`;
		return;
	}
	if ( 'login' === state.screen ) {
		renderLogin();
		return;
	}
	if ( 'org-select' === state.screen ) {
		renderOrgSelect();
		return;
	}
	renderApp();
}

function renderLogin() {
	root.innerHTML = `
		<div class="acp-center-screen">
			<div class="acp-login-card">
				<div class="acp-login-brand">
					<div class="acp-login-mark">A</div>
					<div class="acp-login-title">ACP Prime</div>
				</div>
				${ state.loginError ? `<div class="acp-error">${ escapeHtml( state.loginError ) }</div>` : '' }
				<form id="acp-login-form">
					<div style="position:relative">
						<div class="acp-field">
							<label for="acp-email">Correo</label>
							<input type="email" id="acp-email" required autocomplete="username" ${ state.loginBusy ? 'disabled' : '' } value="${ escapeHtml( localStorage.getItem( 'acp_prime_last_email' ) || '' ) }" />
						</div>
						<div class="acp-field">
							<label for="acp-pin">PIN</label>
							<input type="password" id="acp-pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autocomplete="current-password" ${ state.loginBusy ? 'disabled' : '' } />
						</div>
						${
							state.loginBusy
								? '<div class="acp-fields-overlay"><img src="assets/img/loading.svg" alt="Entrando…" width="36" height="36" /></div>'
								: ''
						}
					</div>
					<button type="submit" class="acp-btn-primary" ${ state.loginBusy ? 'disabled' : '' }>
						${ state.loginBusy ? 'Entrando…' : 'Entrar' }
					</button>
				</form>
			</div>
		</div>
	`;

	const pinInput = document.getElementById( 'acp-pin' );
	pinInput.addEventListener( 'input', () => {
		pinInput.value = pinInput.value.replace( /\D/g, '' ).slice( 0, 6 );
	} );

	document.getElementById( 'acp-login-form' ).addEventListener( 'submit', ( e ) => {
		e.preventDefault();
		const email = document.getElementById( 'acp-email' ).value.trim();
		const pin = pinInput.value;
		localStorage.setItem( 'acp_prime_last_email', email );
		handleLogin( email, pin );
	} );

	// Si ya hay un correo guardado, el foco va directo al PIN — no hace
	// falta tocar el campo de correo para volver a entrar.
	if ( localStorage.getItem( 'acp_prime_last_email' ) ) {
		pinInput.focus();
	}
}

function renderOrgSelect() {
	root.innerHTML = `
		<div class="acp-center-screen">
			<div class="acp-login-card">
				<div class="acp-login-brand">
					<div class="acp-login-mark">A</div>
					<div class="acp-login-title">¿Con qué empresa quieres entrar?</div>
				</div>
				<div style="display:flex;flex-direction:column;gap:10px">
					${ state.memberships
						.map(
							( m ) => `
						<button type="button" class="acp-btn-secondary" data-org="${ m.organization_id }">
							${ escapeHtml( m.organizations.name ) }
							<span style="display:block;font-size:12px;color:var(--text-muted);margin-top:2px">${ escapeHtml( capitalize( m.role ) ) }</span>
						</button>
					`
						)
						.join( '' ) }
				</div>
			</div>
		</div>
	`;

	root.querySelectorAll( '[data-org]' ).forEach( ( btn ) => {
		btn.addEventListener( 'click', () => {
			const membership = state.memberships.find( ( m ) => m.organization_id === btn.dataset.org );
			selectMembership( membership, state.memberships );
		} );
	} );
}

function renderApp() {
	const m = state.activeMembership;
	const perms = permissionsFor( m );
	const initials = m.full_name
		.split( ' ' )
		.map( ( p ) => p[ 0 ] )
		.slice( 0, 2 )
		.join( '' )
		.toUpperCase();

	root.innerHTML = `
		<div class="acp-shell">
			<div class="acp-sidebar">
				<div class="acp-sidebar__brand">
					<div class="acp-login-mark" style="width:32px;height:32px">A</div>
					<div class="acp-login-title" style="font-size:16px">ACP Prime</div>
				</div>
				<div class="acp-sidebar__org">${ escapeHtml( m.organizations.name ) }</div>
				<nav class="acp-nav">
					${ navItemsFor( perms ).map(
						( item ) => `
						<button type="button" class="acp-nav__item ${ item.id === state.activeNav ? 'is-active' : '' }" data-nav="${ item.id }">
							${ item.label }
						</button>
					`
					).join( '' ) }
					${
						state.memberships.length > 1
							? '<button type="button" class="acp-nav__item" data-nav="switch-org">Cambiar de empresa</button>'
							: ''
					}
				</nav>
				<div class="acp-sidebar__spacer"></div>
				<div class="acp-sidebar__user">
					<div class="acp-sidebar__avatar">${ escapeHtml( initials ) }</div>
					<div style="flex:1;min-width:0">
						<div style="font-size:13px;font-weight:600">${ escapeHtml( m.full_name ) }</div>
						<div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">${ escapeHtml( capitalize( m.role ) ) }</div>
						<button type="button" class="acp-sidebar__logout" id="acp-logout">Cerrar sesión</button>
					</div>
				</div>
			</div>
			<div class="acp-main" id="acp-main"></div>
		</div>
	`;

	document.getElementById( 'acp-logout' ).addEventListener( 'click', handleLogout );

	root.querySelectorAll( '[data-nav]' ).forEach( ( btn ) => {
		btn.addEventListener( 'click', () => {
			if ( 'switch-org' === btn.dataset.nav ) {
				sessionStorage.removeItem( 'acp_prime_org_id' );
				setState( { screen: 'org-select' } );
				return;
			}
			setState( { activeNav: btn.dataset.nav, navParams: null } );
		} );
	} );

	renderMain();
}

function renderMain() {
	const main = document.getElementById( 'acp-main' );
	const m = state.activeMembership;
	const perms = permissionsFor( m );
	const ctx = {
		supabase,
		org: m.organizations,
		isAdmin: perms.isAdmin,
		canSeeDashboard: perms.canSeeDashboard,
		canSeeGastos: perms.canSeeGastos,
		canSeeProductos: perms.canSeeProductos,
		canCreateProducts: perms.canCreateProducts,
		canEditProducts: perms.canEditProducts,
		membership: m,
		navigateTo,
		navParams: state.navParams,
	};

	if ( 'dashboard' === state.activeNav && ctx.canSeeDashboard ) {
		renderDashboard( main, ctx );
		return;
	}

	if ( 'productos' === state.activeNav && ctx.canSeeProductos ) {
		renderProductos( main, ctx );
		return;
	}

	if ( 'gastos' === state.activeNav && ctx.canSeeGastos ) {
		renderGastos( main, ctx );
		return;
	}

	if ( 'ventas' === state.activeNav ) {
		renderVentas( main, ctx );
		return;
	}

	if ( 'configuracion' === state.activeNav ) {
		renderConfiguracion( main, ctx );
		return;
	}
}

function escapeHtml( str ) {
	const div = document.createElement( 'div' );
	div.textContent = str;
	return div.innerHTML;
}

function capitalize( str ) {
	return str.charAt( 0 ).toUpperCase() + str.slice( 1 );
}

init();
