// El "?v=" al final de cada import local es a propósito: los módulos ES se
// cachean agresivo en el navegador y, sin esto, un cambio en el código puede
// no reflejarse hasta hacer un refresco forzado (Ctrl+Shift+R). Se sube este
// número cada vez que se toca alguno de estos archivos.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=2';
import { renderProductos } from './screens/productos.js?v=2';
import { renderVentas } from './screens/ventas.js?v=2';
import { renderDashboard } from './screens/dashboard.js?v=1';
import { renderConfiguracion } from './screens/configuracion.js?v=1';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const root = document.getElementById('acp-root');

function navItemsFor( role ) {
	const items = [];
	if ( 'administrador' === role ) {
		items.push( { id: 'dashboard', label: 'Dashboard' } );
	}
	items.push( { id: 'ventas', label: 'Ventas' } );
	if ( 'administrador' === role ) {
		items.push( { id: 'productos', label: 'Productos' } );
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
};

function setState( patch ) {
	state = { ...state, ...patch };
	render();
}

async function init() {
	const { data } = await supabase.auth.getSession();
	if ( ! data.session ) {
		setState( { screen: 'login' } );
		return;
	}
	await loadMemberships();
}

async function loadMemberships() {
	const { data, error } = await supabase
		.from( 'memberships' )
		.select( 'id, role, full_name, organization_id, organizations ( id, name, slug )' );

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
	setState( {
		screen: 'app',
		memberships: allMemberships,
		activeMembership: membership,
		activeNav: 'administrador' === membership.role ? 'dashboard' : 'ventas',
	} );
}

async function handleLogin( email, pin ) {
	setState( { loginBusy: true, loginError: '' } );
	const { error } = await supabase.auth.signInWithPassword( { email, password: pin } );
	if ( error ) {
		setState( { loginBusy: false, loginError: 'Correo o PIN incorrecto.' } );
		return;
	}
	setState( { loginBusy: false } );
	await loadMemberships();
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
					<div class="acp-field">
						<label for="acp-email">Correo</label>
						<input type="email" id="acp-email" required autocomplete="username" />
					</div>
					<div class="acp-field">
						<label for="acp-pin">PIN</label>
						<input type="password" id="acp-pin" inputmode="numeric" pattern="[0-9]*" maxlength="6" required autocomplete="current-password" />
					</div>
					<button type="submit" class="acp-btn-primary" ${ state.loginBusy ? 'disabled' : '' }>
						${
							state.loginBusy
								? '<span style="display:inline-flex;align-items:center;gap:8px;justify-content:center"><img src="assets/img/loading.svg" alt="" width="20" height="20" /> Entrando…</span>'
								: 'Entrar'
						}
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
		handleLogin( email, pin );
	} );
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
					${ navItemsFor( m.role ).map(
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
			setState( { activeNav: btn.dataset.nav } );
		} );
	} );

	renderMain();
}

function renderMain() {
	const main = document.getElementById( 'acp-main' );
	const m = state.activeMembership;
	const ctx = { supabase, org: m.organizations, isAdmin: 'administrador' === m.role, membership: m };

	if ( 'dashboard' === state.activeNav && ctx.isAdmin ) {
		renderDashboard( main, ctx );
		return;
	}

	if ( 'productos' === state.activeNav && ctx.isAdmin ) {
		renderProductos( main, ctx );
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
