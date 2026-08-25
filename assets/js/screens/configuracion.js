import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js?v=2';

const PERMISSION_MODULES = [
	{ key: 'dashboard', label: 'Dashboard', hint: 'Ver montos invertidos, ganancias y gastos del negocio.' },
	{ key: 'gastos', label: 'Gastos', hint: 'Ver y registrar gastos del negocio.' },
	{ key: 'productos', label: 'Productos', hint: 'Ver el catálogo y cargar productos nuevos (nunca editar stock/precio existente).' },
];

const DEFAULT_VENDOR_PERMISSIONS = { dashboard: true, gastos: true, productos: false };

export function renderConfiguracion( main, ctx ) {
	const { supabase, org, isAdmin } = ctx;
	let members = [];
	let currentUserId = null;
	let addMode = 'new'; // 'new' | 'existing'
	let saving = false;
	let errorMsg = '';
	let successMsg = '';
	let activeTab = 'usuarios'; // 'usuarios' | 'permisos' | 'precios'
	let selectedVendorId = null;
	let savingPermission = null; // key del toggle que está guardando ahora mismo
	let savingMargin = false;

	load();

	async function load() {
		main.innerHTML = '<div class="acp-empty-state">Cargando…</div>';

		const [ membersRes, userRes ] = await Promise.all( [
			supabase.from( 'memberships' ).select( 'id, user_id, full_name, role, vendor_permissions' ).eq( 'organization_id', org.id ).order( 'full_name' ),
			supabase.auth.getUser(),
		] );

		if ( membersRes.error ) {
			errorMsg = 'No se pudo cargar el equipo: ' + membersRes.error.message;
			draw();
			return;
		}

		members = membersRes.data || [];
		currentUserId = userRes.data?.user?.id || null;

		const vendedores = members.filter( ( m ) => 'vendedor' === m.role );
		if ( ! selectedVendorId || ! vendedores.some( ( v ) => v.id === selectedVendorId ) ) {
			selectedVendorId = vendedores[ 0 ]?.id || null;
		}

		draw();
	}

	function draw() {
		main.innerHTML = `
			<div style="margin-bottom:24px">
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Configuración</div>
			</div>
			${ errorMsg ? `<div class="acp-error">${ esc( errorMsg ) }</div>` : '' }
			${ successMsg ? `<div class="acp-error" style="background:oklch(0.72 0.16 152 / 0.12);border-color:oklch(0.72 0.16 152 / 0.35);color:oklch(0.72 0.16 152)">${ esc( successMsg ) }</div>` : '' }

			${ isAdmin ? tabsHtml() : '' }
			${
				isAdmin
					? 'permisos' === activeTab
						? permissionsSectionHtml()
						: 'precios' === activeTab
							? precioSectionHtml()
							: membersSectionHtml()
					: '<div class="acp-empty-state">No hay ajustes disponibles para tu rol.</div>'
			}
		`;

		if ( isAdmin ) {
			wireTabs();
			if ( 'permisos' === activeTab ) {
				wirePermissionsSection();
			} else if ( 'precios' === activeTab ) {
				wirePrecioSection();
			} else {
				wireMembersSection();
			}
		}
	}

	function tabsHtml() {
		const tabs = [
			[ 'usuarios', 'Usuarios' ],
			[ 'permisos', 'Permisos' ],
			[ 'precios', 'Precios' ],
		];
		return `
			<div style="display:flex;gap:4px;margin-bottom:24px;background:var(--input-bg);border-radius:9px;padding:3px;max-width:320px">
				${ tabs
					.map(
						( [ id, label ] ) => `
					<button type="button" class="acp-mode-btn" data-tab="${ id }" style="flex:1;padding:8px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ id === activeTab ? 'var(--accent)' : 'transparent' };color:${ id === activeTab ? 'var(--accent-contrast)' : 'var(--text-muted)' }">${ label }</button>
				`
					)
					.join( '' ) }
			</div>
		`;
	}

	function precioSectionHtml() {
		const currentPercent = org.suggested_margin_percent ?? 30;
		return `
			<div style="font-size:15px;font-weight:700;margin-bottom:6px">% de ganancia sugerido</div>
			<div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;max-width:480px">
				Cuando cargas un producto o repones stock y dejas el precio en blanco, se sugiere costo + este porcentaje. Solo afecta la sugerencia — siempre puedes escribir el precio que quieras.
			</div>
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;max-width:320px">
				<div class="acp-field" style="margin-bottom:14px">
					<label>Porcentaje (0 a 100)</label>
					<input id="c-margin" type="number" min="0" max="100" step="1" value="${ esc( currentPercent ) }" />
				</div>
				<button type="button" class="acp-btn-primary" id="c-margin-save" ${ savingMargin ? 'disabled' : '' } style="width:auto;padding:10px 20px">
					${ savingMargin ? 'Guardando…' : 'Guardar' }
				</button>
			</div>
		`;
	}

	function wirePrecioSection() {
		document.getElementById( 'c-margin-save' ).addEventListener( 'click', handleSaveMargin );
	}

	async function handleSaveMargin() {
		const raw = document.getElementById( 'c-margin' ).value.trim();
		const value = Math.round( Number( raw ) );

		if ( '' === raw || Number.isNaN( value ) || value < 0 || value > 100 ) {
			errorMsg = 'El porcentaje debe ser un número entre 0 y 100.';
			draw();
			return;
		}

		savingMargin = true;
		errorMsg = '';
		draw();

		const { error } = await supabase.from( 'organizations' ).update( { suggested_margin_percent: value } ).eq( 'id', org.id );

		savingMargin = false;

		if ( error ) {
			errorMsg = 'No se pudo guardar: ' + error.message;
			draw();
			return;
		}

		org.suggested_margin_percent = value;
		successMsg = 'Porcentaje actualizado.';
		draw();
	}

	function wireTabs() {
		main.querySelectorAll( '[data-tab]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				activeTab = btn.dataset.tab;
				errorMsg = '';
				draw();
			} );
		} );
	}

	function permissionsSectionHtml() {
		const vendedores = members.filter( ( m ) => 'vendedor' === m.role );

		if ( 0 === vendedores.length ) {
			return '<div class="acp-empty-state">Todavía no hay vendedores en esta empresa. Agrega uno desde la pestaña "Usuarios".</div>';
		}

		const selected = vendedores.find( ( v ) => v.id === selectedVendorId ) || vendedores[ 0 ];
		const permissions = Object.assign( {}, DEFAULT_VENDOR_PERMISSIONS, selected.vendor_permissions || {} );

		return `
			<div class="acp-field" style="max-width:320px;margin-bottom:20px">
				<label>Vendedor</label>
				<select id="c-vendor-select" style="background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:12px 14px;color:var(--text);font-size:15px;font-family:inherit">
					${ vendedores.map( ( v ) => `<option value="${ v.id }" ${ v.id === selected.id ? 'selected' : '' }>${ esc( v.full_name ) }</option>` ).join( '' ) }
				</select>
			</div>

			<div style="font-size:15px;font-weight:700;margin-bottom:12px">Permisos de ${ esc( selected.full_name ) }</div>
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:28px;max-width:640px">
				${ PERMISSION_MODULES.map( ( mod ) => `
					<div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border)">
						<div style="flex:1;min-width:0">
							<div style="font-size:14px;font-weight:600">${ esc( mod.label ) }</div>
							<div style="font-size:12px;color:var(--text-muted);margin-top:2px">${ esc( mod.hint ) }</div>
						</div>
						<button
							type="button"
							data-toggle-permission="${ mod.key }"
							aria-pressed="${ !! permissions[ mod.key ] }"
							${ savingPermission ? 'disabled' : '' }
							style="width:44px;height:26px;border-radius:20px;border:none;cursor:pointer;flex-shrink:0;position:relative;background:${ permissions[ mod.key ] ? 'var(--accent)' : 'var(--input-bg)' };opacity:${ savingPermission === mod.key ? '0.6' : '1' };transition:background 0.15s ease"
						>
							<span style="position:absolute;top:3px;left:${ permissions[ mod.key ] ? '21px' : '3px' };width:20px;height:20px;border-radius:50%;background:#fff;transition:left 0.15s ease"></span>
						</button>
					</div>
				` ).join( '' ) }
			</div>
		`;
	}

	function wirePermissionsSection() {
		const select = document.getElementById( 'c-vendor-select' );
		if ( select ) {
			select.addEventListener( 'change', () => {
				selectedVendorId = select.value;
				errorMsg = '';
				draw();
			} );
		}

		main.querySelectorAll( '[data-toggle-permission]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => handleTogglePermission( btn.dataset.togglePermission ) );
		} );
	}

	async function handleTogglePermission( key ) {
		if ( savingPermission ) {
			return;
		}

		const vendedores = members.filter( ( m ) => 'vendedor' === m.role );
		const selected = vendedores.find( ( v ) => v.id === selectedVendorId );
		if ( ! selected ) {
			return;
		}

		const currentPermissions = Object.assign( {}, DEFAULT_VENDOR_PERMISSIONS, selected.vendor_permissions || {} );
		const nextPermissions = Object.assign( {}, currentPermissions, { [ key ]: ! currentPermissions[ key ] } );

		savingPermission = key;
		errorMsg = '';
		draw();

		const { error } = await supabase.from( 'memberships' ).update( { vendor_permissions: nextPermissions } ).eq( 'id', selected.id );

		savingPermission = null;

		if ( error ) {
			errorMsg = 'No se pudo actualizar el permiso: ' + error.message;
			draw();
			return;
		}

		selected.vendor_permissions = nextPermissions;
		draw();
	}

	function membersSectionHtml() {
		return `
			<div style="font-size:15px;font-weight:700;margin-bottom:12px">Usuarios de ${ esc( org.name ) }</div>
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin-bottom:28px;max-width:640px">
				${ members
					.map( ( m ) => {
						const isSelf = m.user_id === currentUserId;
						return `
					<div style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border)">
						<div style="flex:1;min-width:0">
							<div style="font-size:14px;font-weight:600">${ esc( m.full_name ) }${ isSelf ? ' <span style="color:var(--text-muted);font-weight:400">(tú)</span>' : '' }</div>
						</div>
						<div style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px;background:${ 'administrador' === m.role ? 'oklch(0.72 0.16 152 / 0.15)' : 'oklch(0.6 0.02 255 / 0.15)' };color:${ 'administrador' === m.role ? 'oklch(0.72 0.16 152)' : 'var(--text-muted)' }">${ esc( capitalize( m.role ) ) }</div>
						${
							isSelf
								? ''
								: `
							<button type="button" class="acp-btn-secondary" style="width:auto;padding:6px 12px;font-size:12px" data-toggle-role="${ m.id }" data-current-role="${ m.role }">
								${ 'administrador' === m.role ? 'Hacer vendedor' : 'Hacer admin' }
							</button>
							<button type="button" style="background:none;border:none;color:oklch(0.65 0.18 25);cursor:pointer;font-size:12px" data-remove="${ m.id }">Quitar</button>
						`
						}
					</div>
				`;
					} )
					.join( '' ) }
			</div>

			<div style="font-size:15px;font-weight:700;margin-bottom:12px">Agregar usuario</div>
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;max-width:480px">
				<div style="display:flex;gap:4px;margin-bottom:18px;background:var(--input-bg);border-radius:9px;padding:3px">
					<button type="button" class="acp-mode-btn" data-mode="new" style="flex:1;padding:8px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ 'new' === addMode ? 'var(--accent)' : 'transparent' };color:${ 'new' === addMode ? 'var(--accent-contrast)' : 'var(--text-muted)' }">Usuario nuevo</button>
					<button type="button" class="acp-mode-btn" data-mode="existing" style="flex:1;padding:8px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ 'existing' === addMode ? 'var(--accent)' : 'transparent' };color:${ 'existing' === addMode ? 'var(--accent-contrast)' : 'var(--text-muted)' }">Ya tiene cuenta</button>
				</div>

				<div class="acp-field">
					<label>Nombre</label>
					<input id="u-name" placeholder="Nombre completo" />
				</div>

				${
					'new' === addMode
						? `
					<div class="acp-field">
						<label>Correo</label>
						<input id="u-email" type="email" placeholder="correo@ejemplo.com" />
					</div>
					<div class="acp-field">
						<label>PIN (6 dígitos)</label>
						<input id="u-pin" inputmode="numeric" maxlength="6" placeholder="123456" />
					</div>
				`
						: `
					<div class="acp-field">
						<label>UID del usuario (Authentication → Users en Supabase)</label>
						<input id="u-uid" placeholder="00000000-0000-0000-0000-000000000000" />
					</div>
				`
				}

				<div class="acp-field">
					<label>Rol</label>
					<select id="u-role" style="background:var(--input-bg);border:1px solid var(--border);border-radius:10px;padding:12px 14px;color:var(--text);font-size:15px;font-family:inherit">
						<option value="vendedor">Vendedor</option>
						<option value="administrador">Administrador</option>
					</select>
				</div>

				<button type="button" class="acp-btn-primary" id="u-save" ${ saving ? 'disabled' : '' } style="width:auto;padding:10px 20px">
					${ saving ? 'Guardando…' : 'Agregar' }
				</button>
			</div>
		`;
	}

	function wireMembersSection() {
		main.querySelectorAll( '.acp-mode-btn[data-mode]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				addMode = btn.dataset.mode;
				errorMsg = '';
				draw();
			} );
		} );

		main.querySelectorAll( '[data-toggle-role]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				const newRole = 'administrador' === btn.dataset.currentRole ? 'vendedor' : 'administrador';
				handleRoleChange( btn.dataset.toggleRole, newRole );
			} );
		} );

		main.querySelectorAll( '[data-remove]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => handleRemove( btn.dataset.remove ) );
		} );

		const saveBtn = document.getElementById( 'u-save' );
		if ( saveBtn ) {
			saveBtn.addEventListener( 'click', handleAddUser );
		}
	}

	async function handleRoleChange( membershipId, newRole ) {
		errorMsg = '';
		const { error } = await supabase.from( 'memberships' ).update( { role: newRole } ).eq( 'id', membershipId );
		if ( error ) {
			errorMsg = 'No se pudo cambiar el rol: ' + error.message;
			draw();
			return;
		}
		await load();
	}

	async function handleRemove( membershipId ) {
		errorMsg = '';
		const { error } = await supabase.from( 'memberships' ).delete().eq( 'id', membershipId );
		if ( error ) {
			errorMsg = 'No se pudo quitar: ' + error.message;
			draw();
			return;
		}
		await load();
	}

	async function handleAddUser() {
		const fullName = document.getElementById( 'u-name' ).value.trim();
		const role = document.getElementById( 'u-role' ).value;
		const email = document.getElementById( 'u-email' )?.value.trim() || '';
		const pin = document.getElementById( 'u-pin' )?.value.trim() || '';
		const uid = document.getElementById( 'u-uid' )?.value.trim() || '';

		if ( '' === fullName ) {
			errorMsg = 'El nombre es obligatorio.';
			draw();
			return;
		}

		if ( 'new' === addMode ) {
			if ( '' === email || 6 !== pin.length ) {
				errorMsg = 'Correo y un PIN de 6 dígitos son obligatorios.';
				draw();
				return;
			}
		} else if ( '' === uid ) {
			errorMsg = 'El UID es obligatorio.';
			draw();
			return;
		}

		saving = true;
		errorMsg = '';
		draw();

		let userId = uid;

		if ( 'new' === addMode ) {
			// Cliente aislado (storageKey propio) para que crear esta cuenta
			// no le pise la sesión al administrador que está logueado.
			const { createClient } = await import( 'https://esm.sh/@supabase/supabase-js@2' );
			const tempClient = createClient( SUPABASE_URL, SUPABASE_ANON_KEY, {
				auth: { storageKey: 'acp-prime-temp-signup', persistSession: false },
			} );

			const { data, error } = await tempClient.auth.signUp( { email, password: pin } );

			if ( error ) {
				saving = false;
				errorMsg = 'No se pudo crear el usuario: ' + error.message;
				draw();
				return;
			}
			if ( ! data.user ) {
				saving = false;
				errorMsg = 'Ese correo ya tiene una cuenta. Usa "Ya tiene cuenta" con su UID (Authentication → Users).';
				draw();
				return;
			}
			userId = data.user.id;
		}

		const { error: membershipError } = await supabase
			.from( 'memberships' )
			.insert( { user_id: userId, organization_id: org.id, full_name: fullName, role } );

		saving = false;

		if ( membershipError ) {
			errorMsg = 'Usuario creado, pero no se pudo vincular a la empresa: ' + membershipError.message;
			draw();
			return;
		}

		successMsg = 'Usuario agregado.';
		await load();
	}
}

function capitalize( str ) {
	return str.charAt( 0 ).toUpperCase() + str.slice( 1 );
}

function esc( str ) {
	const div = document.createElement( 'div' );
	div.textContent = str ?? '';
	return div.innerHTML;
}
