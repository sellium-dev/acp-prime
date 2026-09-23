// El "?v=" al final de cada import local es a propósito: los módulos ES se
// cachean agresivo en el navegador y, sin esto, un cambio en el código puede
// no reflejarse hasta hacer un refresco forzado (Ctrl+Shift+R). Se sube este
// número cada vez que se toca alguno de estos archivos.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=2';
import { renderProductos } from './screens/productos.js?v=18';
import { renderVentas } from './screens/ventas.js?v=20';
import { renderVentasResumen } from './screens/ventas-resumen.js?v=6';
import { renderDashboard } from './screens/dashboard.js?v=16';
import { renderConfiguracion } from './screens/configuracion.js?v=4';
import { renderGastos } from './screens/gastos.js?v=4';
import { renderAnalitica } from './screens/analitica.js?v=14';

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
		items.push( { id: 'analitica', label: 'Analítica' } );
	}
	items.push( { id: 'ventas', label: 'Ventas' } );
	items.push( { id: 'ventas-resumen', label: 'Resumen del mes', sub: true } );
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
	isSuperAdmin: false,
	creatingOrg: false,
	creatingOrgBusy: false,
	creatingOrgError: '',
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
	// Se piden en paralelo: si no eres super admin, super_admins simplemente
	// no trae ninguna fila tuya (política "select own"), no es un error.
	const [ membershipsRes, superAdminRes ] = await Promise.all( [
		supabase
			.from( 'memberships' )
			.select( 'id, user_id, role, full_name, organization_id, vendor_permissions, organizations ( id, name, slug, suggested_margin_percent )' )
			.eq( 'user_id', userId ),
		supabase.from( 'super_admins' ).select( 'user_id' ).eq( 'user_id', userId ).maybeSingle(),
	] );

	const { data, error } = membershipsRes;
	const isSuperAdmin = !! superAdminRes.data;

	if ( error ) {
		setState( { screen: 'login', loginError: 'No se pudo cargar tu cuenta: ' + error.message } );
		return;
	}

	if ( ! data || 0 === data.length ) {
		// Un super admin recién creado todavía no tiene ninguna empresa —
		// mándalo a la pantalla de selección, donde puede crear la primera,
		// en vez de dejarlo trabado en el mensaje de "sin empresa".
		if ( isSuperAdmin ) {
			setState( { screen: 'org-select', memberships: [], isSuperAdmin } );
			return;
		}
		setState( {
			screen: 'login',
			loginError: 'Tu usuario no tiene ninguna empresa asociada todavía. Pide que te agreguen como miembro.',
		} );
		return;
	}

	const savedOrgId = sessionStorage.getItem( 'acp_prime_org_id' );
	const saved = data.find( ( m ) => m.organization_id === savedOrgId );

	if ( 1 === data.length ) {
		selectMembership( data[ 0 ], data, isSuperAdmin );
		return;
	}

	if ( saved ) {
		selectMembership( saved, data, isSuperAdmin );
		return;
	}

	setState( { screen: 'org-select', memberships: data, isSuperAdmin } );
}

function selectMembership( membership, allMemberships, isSuperAdmin ) {
	sessionStorage.setItem( 'acp_prime_org_id', membership.organization_id );
	const perms = permissionsFor( membership );
	setState( {
		screen: 'app',
		memberships: allMemberships,
		activeMembership: membership,
		activeNav: perms.canSeeDashboard ? 'dashboard' : 'ventas',
		isSuperAdmin: !! isSuperAdmin,
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

				${ state.isSuperAdmin ? renderCreateOrgSection() : '' }
			</div>
		</div>
	`;

	root.querySelectorAll( '[data-org]' ).forEach( ( btn ) => {
		btn.addEventListener( 'click', () => {
			const membership = state.memberships.find( ( m ) => m.organization_id === btn.dataset.org );
			selectMembership( membership, state.memberships, state.isSuperAdmin );
		} );
	} );

	if ( state.isSuperAdmin ) {
		wireCreateOrgSection();
	}
}

// Visible solo para super admins (state.isSuperAdmin, cargado en
// loadMemberships desde la tabla super_admins). Cualquier otro usuario ni
// siquiera ve el botón — y aunque lo viera, el insert real está bloqueado
// del lado del servidor por la política "organizations_insert_super_admin"
// (migración 016), así que la restricción no depende solo de esconder el botón.
function renderCreateOrgSection() {
	if ( ! state.creatingOrg ) {
		return `
			<button type="button" class="acp-btn-secondary" id="acp-org-new-toggle" style="margin-top:14px;border-style:dashed">
				+ Crear nueva empresa
			</button>
		`;
	}

	return `
		<div style="margin-top:16px">
			<div class="acp-field">
				<label>Nombre de la nueva empresa</label>
				<input id="acp-org-name" placeholder="Ej. Lazos de la Suegra" />
			</div>
			<div class="acp-field">
				<label>Tu nombre (como administrador de esa empresa)</label>
				<input id="acp-org-admin-name" placeholder="Tu nombre completo" />
			</div>
			${
				state.creatingOrgError
					? `<div style="color:oklch(0.65 0.18 25);font-size:13px;margin-bottom:10px">${ escapeHtml( state.creatingOrgError ) }</div>`
					: ''
			}
			<div style="display:flex;gap:8px">
				<button type="button" class="acp-btn-primary" id="acp-org-save" ${ state.creatingOrgBusy ? 'disabled' : '' } style="width:auto;padding:10px 20px">
					${ state.creatingOrgBusy ? 'Creando…' : 'Crear empresa' }
				</button>
				<button type="button" class="acp-btn-secondary" id="acp-org-cancel" style="width:auto;padding:10px 20px" ${ state.creatingOrgBusy ? 'disabled' : '' }>
					Cancelar
				</button>
			</div>
		</div>
	`;
}

function wireCreateOrgSection() {
	const toggleBtn = document.getElementById( 'acp-org-new-toggle' );
	if ( toggleBtn ) {
		toggleBtn.addEventListener( 'click', () => setState( { creatingOrg: true, creatingOrgError: '' } ) );
	}

	const cancelBtn = document.getElementById( 'acp-org-cancel' );
	if ( cancelBtn ) {
		cancelBtn.addEventListener( 'click', () => setState( { creatingOrg: false, creatingOrgError: '' } ) );
	}

	const saveBtn = document.getElementById( 'acp-org-save' );
	if ( saveBtn ) {
		saveBtn.addEventListener( 'click', handleCreateOrg );
	}
}

function slugify( name ) {
	return name
		.normalize( 'NFD' )
		.replace( /[̀-ͯ]/g, '' )
		.toLowerCase()
		.trim()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /(^-|-$)/g, '' );
}

async function handleCreateOrg() {
	const name = document.getElementById( 'acp-org-name' ).value.trim();
	const adminName = document.getElementById( 'acp-org-admin-name' ).value.trim();

	if ( '' === name || '' === adminName ) {
		setState( { creatingOrgError: 'Completa el nombre de la empresa y el tuyo.' } );
		return;
	}

	setState( { creatingOrgBusy: true, creatingOrgError: '' } );

	const {
		data: { user },
	} = await supabase.auth.getUser();

	const baseSlug = slugify( name ) || 'empresa';
	let slug = baseSlug;
	let org = null;
	let orgError = null;

	// organizations.slug es "unique" — si ya existe, reintenta con un
	// sufijo numérico en vez de fallar de una.
	for ( let attempt = 0; attempt < 5; attempt++ ) {
		const { data, error } = await supabase.from( 'organizations' ).insert( { name, slug } ).select().single();
		if ( ! error ) {
			org = data;
			break;
		}
		if ( '23505' !== error.code ) {
			orgError = error;
			break;
		}
		slug = `${ baseSlug }-${ attempt + 2 }`;
	}

	if ( ! org ) {
		setState( {
			creatingOrgBusy: false,
			creatingOrgError: 'No se pudo crear la empresa: ' + ( orgError ? orgError.message : 'inténtalo de nuevo.' ),
		} );
		return;
	}

	const { error: membershipError } = await supabase
		.from( 'memberships' )
		.insert( { user_id: user.id, organization_id: org.id, full_name: adminName, role: 'administrador' } );

	if ( membershipError ) {
		setState( {
			creatingOrgBusy: false,
			creatingOrgError: 'Empresa creada, pero no se pudo vincular tu usuario: ' + membershipError.message,
		} );
		return;
	}

	setState( { creatingOrg: false, creatingOrgBusy: false } );
	await loadMemberships( user.id );
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
						<button type="button" class="acp-nav__item ${ item.sub ? 'acp-nav__item--sub' : '' } ${ item.id === state.activeNav ? 'is-active' : '' }" data-nav="${ item.id }">
							${ item.label }
						</button>
					`
					).join( '' ) }
					${
						state.memberships.length > 1 || state.isSuperAdmin
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

	if ( 'analitica' === state.activeNav && ctx.canSeeDashboard ) {
		renderAnalitica( main, ctx );
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

	if ( 'ventas-resumen' === state.activeNav ) {
		renderVentasResumen( main, ctx );
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
