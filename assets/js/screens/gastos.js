export function renderGastos( main, ctx ) {
	const { supabase, org, membership } = ctx;
	let range = 'mes'; // 'mes' | 'todos'
	let expenses = [];
	let saving = false;
	let errorMsg = '';
	let successMsg = '';

	load();

	async function load() {
		main.innerHTML = '<div class="acp-empty-state">Cargando…</div>';

		let query = supabase
			.from( 'expenses' )
			.select( 'id, description, amount, category, expense_date' )
			.eq( 'organization_id', org.id )
			.order( 'expense_date', { ascending: false } );

		if ( 'mes' === range ) {
			const startOfMonth = new Date();
			startOfMonth.setDate( 1 );
			query = query.gte( 'expense_date', ymd( startOfMonth ) );
		}

		const { data, error } = await query;

		if ( error ) {
			errorMsg = 'No se pudo cargar gastos: ' + error.message;
			draw();
			return;
		}

		expenses = data || [];
		draw();
	}

	function draw() {
		const total = expenses.reduce( ( sum, e ) => sum + Number( e.amount ), 0 );

		main.innerHTML = `
			<div style="margin-bottom:24px">
				<div style="font-size:24px;font-weight:800;letter-spacing:-0.01em">Gastos</div>
			</div>
			${ errorMsg ? `<div class="acp-error">${ esc( errorMsg ) }</div>` : '' }
			${ successMsg ? `<div class="acp-error" style="background:oklch(0.72 0.16 152 / 0.12);border-color:oklch(0.72 0.16 152 / 0.35);color:oklch(0.72 0.16 152)">${ esc( successMsg ) }</div>` : '' }

			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px;max-width:560px;margin-bottom:24px">
				<div style="font-size:14px;font-weight:700;margin-bottom:14px">Registrar gasto</div>
				<div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:10px;margin-bottom:10px">
					<input id="e-description" placeholder="Descripción (ej. publicidad Instagram)" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:13px;font-family:inherit" />
					<input id="e-amount" type="number" step="0.01" placeholder="Monto" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:13px;font-family:inherit" />
				</div>
				<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin-bottom:14px">
					<input id="e-category" placeholder="Categoría (opcional)" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:13px;font-family:inherit" />
					<input id="e-date" type="date" value="${ ymd( new Date() ) }" style="background:var(--input-bg);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:13px;font-family:inherit" />
				</div>
				<button type="button" class="acp-btn-primary" id="e-save" ${ saving ? 'disabled' : '' } style="width:auto;padding:10px 20px">${ saving ? 'Guardando…' : 'Agregar gasto' }</button>
			</div>

			<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
				<div style="display:flex;gap:4px;background:var(--input-bg);border-radius:9px;padding:3px">
					<button type="button" class="acp-mode-btn" data-range="mes" style="padding:7px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ 'mes' === range ? 'var(--accent)' : 'transparent' };color:${ 'mes' === range ? 'var(--accent-contrast)' : 'var(--text-muted)' }">Este mes</button>
					<button type="button" class="acp-mode-btn" data-range="todos" style="padding:7px 14px;border-radius:7px;border:none;cursor:pointer;font-size:12px;font-weight:700;font-family:inherit;background:${ 'todos' === range ? 'var(--accent)' : 'transparent' };color:${ 'todos' === range ? 'var(--accent-contrast)' : 'var(--text-muted)' }">Todos</button>
				</div>
				<div style="font-size:13px;color:var(--text-muted)">Total: <strong style="color:var(--text)">${ money( total ) }</strong></div>
			</div>
			${ 0 === expenses.length ? '<div class="acp-empty-state">No hay gastos en este rango.</div>' : expensesTableHtml() }
		`;

		document.getElementById( 'e-save' ).addEventListener( 'click', handleAddExpense );
		main.querySelectorAll( '[data-range]' ).forEach( ( btn ) => {
			btn.addEventListener( 'click', () => {
				range = btn.dataset.range;
				load();
			} );
		} );
	}

	function expensesTableHtml() {
		return `
			<div style="background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden">
				<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) minmax(0,1fr) minmax(0,1fr);gap:12px;padding:12px 18px;font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;border-bottom:1px solid var(--border)">
					<div>Fecha</div><div>Descripción</div><div>Categoría</div><div>Monto</div>
				</div>
				${ expenses
					.map(
						( e ) => `
					<div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr) minmax(0,1fr) minmax(0,1fr);gap:12px;padding:12px 18px;font-size:13px;border-bottom:1px solid var(--border)">
						<div>${ esc( e.expense_date ) }</div>
						<div>${ esc( e.description ) }</div>
						<div style="color:var(--text-muted)">${ esc( e.category || '—' ) }</div>
						<div style="font-weight:700">${ money( e.amount ) }</div>
					</div>
				`
					)
					.join( '' ) }
			</div>
		`;
	}

	async function handleAddExpense() {
		const description = document.getElementById( 'e-description' ).value.trim();
		const amount = parseFloat( document.getElementById( 'e-amount' ).value );
		const category = document.getElementById( 'e-category' ).value.trim();
		const expenseDate = document.getElementById( 'e-date' ).value;

		if ( '' === description || ! ( amount > 0 ) ) {
			errorMsg = 'Descripción y monto (mayor a 0) son obligatorios.';
			successMsg = '';
			draw();
			return;
		}

		saving = true;
		errorMsg = '';
		successMsg = '';
		draw();

		const { error } = await supabase.from( 'expenses' ).insert( {
			organization_id: org.id,
			description,
			amount,
			category: category || null,
			expense_date: expenseDate,
			created_by: membership.user_id,
		} );

		saving = false;

		if ( error ) {
			errorMsg = 'No se pudo guardar el gasto: ' + error.message;
			draw();
			return;
		}

		successMsg = 'Gasto registrado.';
		await load();
	}
}

function ymd( date ) {
	return date.toISOString().slice( 0, 10 );
}

function money( n ) {
	return '$' + Number( n ).toLocaleString( 'es-CL', { maximumFractionDigits: 0 } );
}

function esc( str ) {
	const div = document.createElement( 'div' );
	div.textContent = str ?? '';
	return div.innerHTML;
}
