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
	let activeTab = 'usuarios'; // 'usuarios' | 'permisos' | 'precios' | 'cargas'
	let selectedVendorId = null;
	let savingPermission = null; // key del toggle que está guardando ahora mismo
	let savingMargin = false;
	let cargas = null; // null = todavía no se cargó la pestaña "Cargas"
	let loadingCargas = false;
	let deletingCargaId = null;
	let mergingCargaId = null;

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
							: 'cargas' === activeTab
								? cargasSectionHtml()
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
			} else if ( 'cargas' === activeTab ) {
				wireCargasSection();
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
			[ 'cargas', 'Cargas' ],
		];
		return `
			<div style="display:flex;gap:4px;margin-bottom:24px;background:var(--input-bg);border-radius:9px;padding:3px;max-width:440px">
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

	// Misma agrupación y numeración de "Carga N" que Analítica y Productos
	// (por purchase_id, cronológico, solo cuentan las que tienen stock) — así
	// "Carga 4" acá es la misma Carga 4 que se ve en esas pantallas. Una carga
	// sin ningún lote no aparece en ellas; acá sí, como "Carga vacía", porque
	// es justo la única que se puede eliminar.
	async function loadCargas() {
		loadingCargas = true;
		errorMsg = '';
		draw();

		const [ purchasesRes, lotsRes ] = await Promise.all( [
			supabase.from( 'stock_purchases' ).select( 'id, created_at' ).eq( 'organization_id', org.id ),
			supabase
				.from( 'stock_lots' )
				.select( 'id, purchase_id, quantity, remaining_quantity, created_at, product_variants ( products ( name ) ), stock_purchases ( created_at ) ' )
				.eq( 'organization_id', org.id ),
		] );

		loadingCargas = false;

		if ( purchasesRes.error || lotsRes.error ) {
			errorMsg = 'No se pudieron cargar las cargas: ' + ( purchasesRes.error || lotsRes.error ).message;
			cargas = [];
			draw();
			return;
		}

		const groups = new Map();
		( lotsRes.data || [] ).forEach( ( l ) => {
			const key = l.purchase_id || `lote-${ l.id }`;
			if ( ! groups.has( key ) ) {
				groups.set( key, {
					id: l.purchase_id,
					createdAt: l.stock_purchases?.created_at || l.created_at,
					lotCount: 0,
					bought: 0,
					remaining: 0,
					products: new Set(),
				} );
			}
			const g = groups.get( key );
			g.lotCount += 1;
			g.bought += l.quantity;
			g.remaining += l.remaining_quantity;
			g.products.add( l.product_variants?.products?.name || 'Producto' );
		} );

		const withStock = Array.from( groups.values() ).sort( ( a, b ) => new Date( a.createdAt ) - new Date( b.createdAt ) );
		withStock.forEach( ( g, i ) => {
			g.label = `Carga ${ i + 1 }`;
			g.empty = false;
		} );

		const usedIds = new Set( withStock.map( ( g ) => g.id ).filter( Boolean ) );
		const empties = ( purchasesRes.data || [] )
			.filter( ( p ) => ! usedIds.has( p.id ) )
			.map( ( p ) => ( { id: p.id, createdAt: p.created_at, label: 'Carga vacía', empty: true, lotCount: 0, bought: 0, remaining: 0, products: new Set() } ) );

		cargas = [ ...withStock, ...empties ].sort( ( a, b ) => new Date( a.createdAt ) - new Date( b.createdAt ) );
		draw();
	}

	function cargasSectionHtml() {
		if ( loadingCargas || null === cargas ) {
			return '<div class="acp-empty-state">Cargando…</div>';
		}

		return `
			<div style="font-size:15px;font-weight:700;margin-bottom:6px">Cargas de stock</div>
			<div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;max-width:560px">
				Una carga solo se puede eliminar si no tiene ningún producto/stock dentro. Si una carga quedó con algo adentro por error, primero hay que sacar ese contenido; después aparece como "Carga vacía" y se puede eliminar.
			</div>
			<div style="display:flex;flex-direction:column;gap:10px;max-width:720px">
				${
					0 === cargas.length
						? '<div class="acp-empty-state">Todavía no hay cargas.</div>'
						: cargas.map( cargaRowHtml ).join( '' )
				}
			</div>
		`;
	}

	function cargaRowHtml( c ) {
		const names = Array.from( c.products );
		const busy = null !== deletingCargaId || null !== mergingCargaId;
		// Destinos posibles para fusionar: cualquier otra carga real con stock.
		// Viene preseleccionada la carga anterior (por fecha), que es la que
		// casi siempre se quiere cuando una compra se guardó partida en dos.
		const targets = cargas.filter( ( x ) => x.id && ! x.empty && x.id !== c.id );
		const idx = cargas.indexOf( c );
		const defaultTarget = [ ...targets ].reverse().find( ( x ) => cargas.indexOf( x ) < idx ) || targets[ 0 ];
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px">
				<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
					<div style="font-size:14px;font-weight:700">${ esc( c.label ) } <span style="font-weight:400;color:var(--text-muted)">· ${ formatDate( c.createdAt ) }</span></div>
					${
						c.empty
							? `<button type="button" class="acp-btn-secondary" style="width:auto;padding:6px 14px;font-size:12px;color:oklch(0.65 0.18 25)" data-delete-carga="${ c.id }" ${ busy ? 'disabled' : '' }>${ deletingCargaId === c.id ? 'Eliminando…' : 'Eliminar carga' }</button>`
							: '<span style="font-size:11px;color:var(--text-muted)">No se puede eliminar: tiene stock adentro — se puede fusionar</span>'
					}
				</div>
				${
					c.empty
						? '<div style="font-size:12px;color:var(--text-muted);margin-top:6px">Sin productos ni stock.</div>'
						: `<div style="font-size:12px;color:var(--text-muted);margin-top:6px">${ names.length } ${ 1 === names.length ? 'producto' : 'productos' } · ${ c.lotCount } ${ 1 === c.lotCount ? 'variante' : 'variantes' } · ${ c.bought } uds compradas · ${ c.remaining } en stock · ${ c.bought - c.remaining } vendidas</div>
						<div style="font-size:12px;margin-top:4px">${ esc( names.join( ', ' ) ) }</div>`
				}
				${
					! c.empty && c.id && targets.length > 0
						? `
					<div style="display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap">
						<span style="font-size:12px;color:var(--text-muted)">Fusionar en:</span>
						<select data-merge-target="${ c.id }" ${ busy ? 'disabled' : '' } style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:6px 10px;color:var(--text);font-size:12px;font-family:inherit">
							${ targets.map( ( t ) => `<option value="${ t.id }" ${ t === defaultTarget ? 'selected' : '' }>${ esc( t.label ) } · ${ formatDate( t.createdAt ) }</option>` ).join( '' ) }
						</select>
						<button type="button" class="acp-btn-secondary" style="width:auto;padding:6px 14px;font-size:12px" data-merge-carga="${ c.id }" ${ busy ? 'disabled' : '' }>${ mergingCargaId === c.id ? 'Fusionando…' : 'Fusionar' }</button>
					</div>
				`
						: ''
				}
			</div>
		`;
	}

	function wireCargasSection() {
		main.querySelectorAll( '[data-delete-carga]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => handleDeleteCarga( btn.dataset.deleteCarga ) );
		} );
		main.querySelectorAll( '[data-merge-carga]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => handleMergeCarga( btn.dataset.mergeCarga ) );
		} );
	}

	// La carga origen pasa a ser parte de la destino (queda con la fecha de
	// la destino) y se elimina. Las ventas no se tocan: siguen apuntando a
	// los mismos lotes, solo cambia a qué carga pertenecen.
	async function handleMergeCarga( sourceId ) {
		const select = main.querySelector( `[data-merge-target="${ sourceId }"]` );
		const targetId = select?.value;
		const source = cargas.find( ( c ) => c.id === sourceId );
		const target = cargas.find( ( c ) => c.id === targetId );
		if ( ! source || ! target ) return;

		const ok = window.confirm(
			`Esto mueve todo el contenido de ${ source.label } a ${ target.label } (queda con la fecha ${ formatDate( target.createdAt ) }) y elimina ${ source.label }. Las ventas ya hechas no se tocan. Si la carga que se elimina no es la última, las cargas siguientes cambian de número. ¿Confirmas?`
		);
		if ( ! ok ) return;

		mergingCargaId = sourceId;
		errorMsg = '';
		successMsg = '';
		draw();

		const { error } = await supabase.rpc( 'merge_purchases', { p_source_id: sourceId, p_target_id: targetId } );

		mergingCargaId = null;

		if ( error ) {
			errorMsg = 'No se pudo fusionar: ' + error.message;
			draw();
			return;
		}

		successMsg = `${ source.label } fusionada en ${ target.label }.`;
		await loadCargas();
	}

	async function handleDeleteCarga( purchaseId ) {
		if ( ! window.confirm( 'Esto elimina la carga vacía de forma permanente. ¿Confirmas?' ) ) return;

		deletingCargaId = purchaseId;
		errorMsg = '';
		successMsg = '';
		draw();

		const { error } = await supabase.rpc( 'delete_empty_purchase', { p_purchase_id: purchaseId } );

		deletingCargaId = null;

		if ( error ) {
			errorMsg = 'No se pudo eliminar la carga: ' + error.message;
			draw();
			return;
		}

		successMsg = 'Carga eliminada.';
		await loadCargas();
	}

	function wireTabs() {
		main.querySelectorAll( '[data-tab]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				activeTab = btn.dataset.tab;
				errorMsg = '';
				if ( 'cargas' === activeTab ) {
					loadCargas();
					return;
				}
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

function formatDate( isoString ) {
	const d = new Date( isoString );
	const dd = String( d.getDate() ).padStart( 2, '0' );
	const mm = String( d.getMonth() + 1 ).padStart( 2, '0' );
	return `${ dd }-${ mm }-${ d.getFullYear() }`;
}

function capitalize( str ) {
	return str.charAt( 0 ).toUpperCase() + str.slice( 1 );
}

function esc( str ) {
	const div = document.createElement( 'div' );
	div.textContent = str ?? '';
	return div.innerHTML;
}
